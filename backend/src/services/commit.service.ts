import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  countCommitsForProject,
  findCommitForProject,
  listCommitsForProject,
  upsertCommit,
} from '../db/queries/commits.queries.js'
import type { CommitDiffSummary, CommitFileRow } from '../db/queries/commits.queries.js'
import { notFound } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { toApiCommit } from '../utils/mappers.js'
import type { ApiCommit } from '../utils/mappers.js'
import { commitRisk } from './ml.client.js'
import type { CommitFacts, CommitRiskResult } from './ml.client.js'
import { getOwnedProject } from './project.service.js'

const execFileAsync = promisify(execFile)

const MAX_COMMITS = 50
const MAX_FILES_PER_COMMIT = 200
const GIT_TIMEOUT_MS = 30_000
const MAX_BUFFER = 10 * 1024 * 1024
const RECORD_SEP = '\x1e'
const FIELD_SEP = '\x1f'
const TEST_PATH_RE = /(^|\/)(__tests__|tests?|spec)(\/)|\.(test|spec)\.[a-z]+$/i

/* ------------------------------- Git analysis ------------------------------ */

export interface CommitAnalysisResult {
  git: boolean
  analyzed: number
  note?: string
}

function renameTarget(raw: string): string | null {
  if (!raw.includes('=>')) return null
  const brace = /\{(.+?) => (.+?)\}/.exec(raw)
  if (brace?.[2]) return raw.replace(brace[0], brace[2]).replace('//', '/')
  const parts = raw.split('=>')
  return parts[parts.length - 1]?.trim() ?? null
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1)
  return value
}

interface ParsedCommit {
  sha: string
  author: string | null
  committedAt: Date | null
  message: string
  files: CommitFileRow[]
  additions: number
  deletions: number
}

/** `--raw` status letters → the wire change kind. R/C normalise to the new path. */
const STATUS_LETTERS: Record<string, CommitFileRow['change']> = {
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'added',
}

function changeFromStatus(code: string): CommitFileRow['change'] | null {
  const letter = code[0]?.toUpperCase()
  if (!letter) return null
  return STATUS_LETTERS[letter] ?? 'modified'
}

function parseLog(stdout: string): ParsedCommit[] {
  const commits: ParsedCommit[] = []
  for (const record of stdout.split(RECORD_SEP)) {
    if (!record.trim()) continue
    const newline = record.indexOf('\n')
    const header = newline === -1 ? record : record.slice(0, newline)
    const body = newline === -1 ? '' : record.slice(newline + 1)

    const fields = header.split(FIELD_SEP)
    const sha = fields[0]?.trim() ?? ''
    if (!sha) continue
    const author = fields[1]?.trim() || null
    const committedAtRaw = fields[2]?.trim() ?? ''
    const committedAt = committedAtRaw ? new Date(committedAtRaw) : null
    const message = fields.slice(3).join(FIELD_SEP).trim()

    // --raw lines give the exact A/M/D/R status; --numstat lines give the counts.
    const statusByPath = new Map<string, CommitFileRow['change']>()
    const numstat: Array<{ path: string; additions: number; deletions: number }> = []
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\r$/, '')
      if (!line.trim()) continue

      if (line.startsWith(':')) {
        const parts = line.slice(1).split('\t')
        const meta = (parts[0] ?? '').split(' ')
        const code = meta[meta.length - 1] ?? ''
        const paths = parts.slice(1).map(stripQuotes)
        const target = /^[RC]/i.test(code) ? paths[1] : paths[0]
        const change = changeFromStatus(code)
        if (target && change) statusByPath.set(target, change)
        continue
      }

      const parts = line.split('\t')
      if (parts.length < 3) continue
      const added = parts[0] === '-' ? 0 : Number(parts[0] ?? 0)
      const deleted = parts[1] === '-' ? 0 : Number(parts[1] ?? 0)
      if (Number.isNaN(added) || Number.isNaN(deleted)) continue
      const rawPath = parts.slice(2).join('\t')
      numstat.push({ path: stripQuotes(renameTarget(rawPath) ?? rawPath), additions: added, deletions: deleted })
    }

    const files: CommitFileRow[] = []
    let additions = 0
    let deletions = 0
    for (const entry of numstat) {
      if (files.length >= MAX_FILES_PER_COMMIT) break
      const change =
        statusByPath.get(entry.path) ??
        (entry.additions > 0 && entry.deletions === 0
          ? 'added'
          : entry.additions === 0 && entry.deletions > 0
            ? 'deleted'
            : 'modified')
      files.push({ path: entry.path, change, additions: entry.additions, deletions: entry.deletions })
      additions += entry.additions
      deletions += entry.deletions
    }

    commits.push({
      sha,
      author,
      committedAt: committedAt && !Number.isNaN(committedAt.getTime()) ? committedAt : null,
      message,
      files,
      additions,
      deletions,
    })
  }
  return commits
}

/** Files that changed in more than one of the analysed commits. */
function computeHotspots(commits: ParsedCommit[]): string[] {
  const counts = new Map<string, number>()
  for (const commit of commits) {
    for (const file of new Set(commit.files.map((entry) => entry.path))) {
      counts.set(file, (counts.get(file) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file]) => file)
}

// TODO(ml): replace this git-facts template with an LLM-written commit description
// (small instruct model) served at ML_SERVICE_URL /ml/explain.
function describeCommit(facts: CommitFacts, risk: CommitRiskResult): string {
  const typeMatch = /^(\w+)(\(|:|!)/.exec(facts.message)
  const kind =
    typeMatch?.[1]?.toLowerCase() === 'feat'
      ? 'Adds feature work'
      : typeMatch?.[1]?.toLowerCase() === 'fix'
        ? 'Fixes a defect'
        : typeMatch?.[1]?.toLowerCase() === 'refactor'
          ? 'Refactors without changing behavior'
          : typeMatch?.[1]?.toLowerCase() === 'test'
            ? 'Extends the test suite'
            : typeMatch?.[1]?.toLowerCase() === 'docs'
              ? 'Updates documentation'
              : typeMatch?.[1]?.toLowerCase() === 'chore'
                ? 'Chores and maintenance'
                : 'Changes the codebase'

  const lead = facts.files
    .slice(0, 3)
    .map((file) => file.path)
    .join(', ')
  const more = facts.files.length > 3 ? ` and ${facts.files.length - 3} more file(s)` : ''
  const tests = facts.testsAffected.length
    ? ` Touches ${facts.testsAffected.length} test file${facts.testsAffected.length === 1 ? '' : 's'}.`
    : ' No test files moved with this change.'
  return `${kind} across ${facts.files.length} file${facts.files.length === 1 ? '' : 's'} (+${facts.additions}/−${facts.deletions}), led by ${lead}${more}.${tests} Rule-based risk assessment: ${risk.level} (${Math.round(risk.score * 100)}/100).`
}

/**
 * Reads the project's git history (when the workspace is a repository) and
 * upserts a commit row per revision: files/diff stats, hotspots, rule-based
 * risk and a description stub. Read-only on the workspace; failures never
 * fail the run — history analysis is enrichment, not a pass/fail check.
 */
export async function analyzeProjectCommits(
  workspace: string,
  projectId: string,
): Promise<CommitAnalysisResult> {
  if (!existsSync(path.join(workspace, '.git'))) return { git: false, analyzed: 0 }

  let stdout: string
  try {
    const result = await execFileAsync(
      'git',
      [
        '-C',
        workspace,
        '-c',
        'core.quotepath=false',
        'log',
        '--no-merges',
        '-n',
        String(MAX_COMMITS),
        '--date=iso-strict',
        '--pretty=format:%x1e%H%x1f%an%x1f%aI%x1f%s',
        '--raw',
        '--numstat',
      ],
      {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
      },
    )
    stdout = result.stdout
  } catch (error) {
    logger.warn({ err: error, projectId }, 'Git history could not be read')
    return { git: true, analyzed: 0, note: 'git history could not be read' }
  }

  const commits = parseLog(stdout)
  const hotspots = computeHotspots(commits)
  let analyzed = 0

  for (const commit of commits) {
    try {
      const files = commit.files
      const testsAffected = files
        .filter((file) => TEST_PATH_RE.test(file.path))
        .map((file) => file.path)
        .slice(0, 25)
      const facts: CommitFacts = {
        message: commit.message,
        files,
        additions: commit.additions,
        deletions: commit.deletions,
        testsAffected,
        hotspots,
      }
      const risk = await commitRisk(facts)
      const diffSummary: CommitDiffSummary = {
        files,
        testsAffected,
        hotspots,
        suggestedAction: risk.suggestedAction,
        failingTests: [], // filled once a run ties findings to this commit
      }
      await upsertCommit({
        projectId,
        sha: commit.sha,
        message: commit.message || null,
        author: commit.author,
        committedAt: commit.committedAt,
        filesChanged: files.length,
        linesAdded: commit.additions,
        linesDeleted: commit.deletions,
        diffSummary,
        riskScore: risk.score,
        riskSignals: risk.signals,
        description: describeCommit(facts, risk),
      })
      analyzed += 1
    } catch (error) {
      logger.warn({ err: error, projectId, sha: commit.sha }, 'Could not persist commit analysis')
    }
  }

  return { git: true, analyzed }
}

/* --------------------------------- Read API -------------------------------- */

export interface ListCommitsResult {
  items: ApiCommit[]
  total: number
}

export async function listProjectCommitsForUser(
  userId: string,
  projectId: string,
  params: { page: number; limit: number },
): Promise<ListCommitsResult> {
  await getOwnedProject(userId, projectId)
  const offset = (params.page - 1) * params.limit
  const [rows, total] = await Promise.all([
    listCommitsForProject(projectId, { limit: params.limit, offset }),
    countCommitsForProject(projectId),
  ])
  return { items: rows.map(toApiCommit), total }
}

export async function getProjectCommitForUser(
  userId: string,
  projectId: string,
  sha: string,
): Promise<ApiCommit> {
  await getOwnedProject(userId, projectId)
  const row = await findCommitForProject(projectId, sha)
  if (!row) throw notFound('Commit not found')
  return toApiCommit(row)
}
