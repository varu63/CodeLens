/**
 * Mock REST handlers — mirrors the real API contract end to end.
 * Matched by method + path segments; supports pagination and filters.
 */

import type { InternalAxiosRequestConfig } from 'axios'
import {
  ADMIN_SCREENSHOT_URL,
  artifactCatalog,
  buildArtifact,
  seedUsers,
  simpleStructure,
} from './data'
import {
  cancelMockRun,
  createRun,
  db,
  EXPECTED_CLEAN_CHECKS,
  EXPECTED_STORY_CHECKS,
  findRun,
  isTerminal,
  newId,
  startRunTimeline,
  structureFor,
  summaryOf,
} from './db'
import type {
  CheckType,
  Finding,
  Project,
  Run,
  Severity,
  User,
} from '../types/domain.types'
import type { Paginated } from '../types/api.types'

export interface MockResponse {
  status: number
  data: unknown
  message?: string
}

type Params = Record<string, unknown>

const AGENTS = ['claude_code', 'codex', 'cursor', 'aider'] as const

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/* --------------------------------- Helpers --------------------------------- */

function ok(data: unknown, status = 200): MockResponse {
  return { status, data }
}

function fail(status: number, message: string): MockResponse {
  return { status, data: { message }, message }
}

function readJson<T>(config: InternalAxiosRequestConfig): T | null {
  const raw = config.data
  if (raw == null) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }
  return raw as T
}

function num(params: Params, key: string, fallback: number): number {
  const value = Number(params[key])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function str(params: Params, key: string): string | undefined {
  const value = params[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function paginate<T>(items: T[], params: Params): Paginated<T> {
  const page = Math.max(1, num(params, 'page', 1))
  const limit = Math.min(100, num(params, 'limit', 20))
  const total = items.length
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const start = (page - 1) * limit
  return { items: items.slice(start, start + limit), page, limit, total, totalPages }
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.title.localeCompare(b.title),
  )
}

/* ----------------------------------- Auth ----------------------------------- */

function mockToken(): string {
  return `mock.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`
}

function resolveUser(email: string): User {
  const lower = email.toLowerCase()
  const existing = seedUsers.find((user) => user.email.toLowerCase() === lower)
  if (existing) return existing
  return {
    id: newId('u'),
    email: lower,
    name: lower
      .split('@')[0]
      .split(/[._-]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    role: lower.startsWith('admin') || lower === 'varun@acme.dev' ? 'admin' : 'user',
    createdAt: new Date().toISOString(),
  }
}

function authMe(): MockResponse {
  if (!db.currentUser) return fail(401, 'Not authenticated')
  return ok(db.currentUser)
}

/* --------------------------------- Projects --------------------------------- */

function projectSummary(project: Project): Project {
  const runs = db.runs
    .filter((run) => run.projectId === project.id)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
  const latest = runs[0]
  return {
    ...project,
    latestRun: latest
      ? { id: latest.id, status: latest.status, healthScore: latest.healthScore, startedAt: latest.startedAt }
      : null,
  }
}

function listProjects(params: Params): MockResponse {
  const query = str(params, 'query')?.toLowerCase()
  const items = db.projects
    .map(projectSummary)
    .filter((project) => !query || project.name.toLowerCase().includes(query))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  return ok(paginate(items, params))
}

function createProject(config: InternalAxiosRequestConfig): MockResponse {
  const body = readJson<{ name?: string; gitUrl?: string; branch?: string }>(config)
  if (!body?.name || body.name.trim().length < 2) return fail(400, 'Project name must be at least 2 characters')
  const source = body.gitUrl ? 'git' : 'zip'
  const project: Project = {
    id: newId('p'),
    name: body.name.trim(),
    source,
    gitUrl: body.gitUrl,
    branch: body.gitUrl ? body.branch ?? 'main' : undefined,
    stack: {
      language: 'TypeScript',
      framework: 'Express',
      runtime: 'Node 20',
      database: 'PostgreSQL 15',
      packageManager: 'npm',
      frontend: 'React 18',
      testFrameworks: ['Jest'],
      dependencies: ['express', 'pg', 'react'],
    },
    routeCount: 3,
    tableCount: 1,
    componentCount: 1,
    apiCallCount: 1,
    settings: { defaultLoadUsers: 50, errorRateThresholdPct: 5, p95ThresholdMs: 800 },
    latestRun: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  db.projects.push(project)
  db.structure.set(project.id, simpleStructure())
  return ok(project, 201)
}

function uploadProject(config: InternalAxiosRequestConfig, projectId: string): MockResponse {
  const project = db.projects.find((item) => item.id === projectId)
  if (!project) return fail(404, 'Project not found')
  const form = config.data
  let fileSize = 4_563_210
  if (form instanceof FormData) {
    const file = form.get('file')
    if (file instanceof File) fileSize = file.size
  }
  project.source = 'zip'
  project.updatedAt = new Date().toISOString()
  return ok({
    project,
    filesDetected: 214,
    bytesUploaded: fileSize,
  })
}

function patchProject(config: InternalAxiosRequestConfig, projectId: string): MockResponse {
  const project = db.projects.find((item) => item.id === projectId)
  if (!project) return fail(404, 'Project not found')
  const body = readJson<{ name?: string; settings?: Partial<Project['settings']> }>(config)
  if (!body) return fail(400, 'Invalid request body')
  if (body.name !== undefined) {
    if (body.name.trim().length < 2) return fail(400, 'Project name must be at least 2 characters')
    project.name = body.name.trim()
  }
  if (body.settings) {
    const settings = body.settings
    if (settings.defaultLoadUsers !== undefined && (settings.defaultLoadUsers < 1 || settings.defaultLoadUsers > 10_000)) {
      return fail(400, 'Default load users must be between 1 and 10000')
    }
    if (settings.errorRateThresholdPct !== undefined && (settings.errorRateThresholdPct < 0 || settings.errorRateThresholdPct > 100)) {
      return fail(400, 'Error rate threshold must be between 0 and 100')
    }
    if (settings.p95ThresholdMs !== undefined && settings.p95ThresholdMs <= 0) {
      return fail(400, 'p95 threshold must be a positive number of milliseconds')
    }
    project.settings = { ...project.settings, ...settings }
  }
  project.updatedAt = new Date().toISOString()
  return ok(project)
}

function deleteProject(projectId: string): MockResponse {
  const index = db.projects.findIndex((item) => item.id === projectId)
  if (index === -1) return fail(404, 'Project not found')
  const runIds = new Set(db.runs.filter((run) => run.projectId === projectId).map((run) => run.id))
  db.projects.splice(index, 1)
  db.runs = db.runs.filter((run) => run.projectId !== projectId)
  db.checks = db.checks.filter((check) => !runIds.has(check.runId))
  db.findings = db.findings.filter((finding) => finding.projectId !== projectId)
  db.commits = db.commits.filter((commit) => commit.projectId !== projectId)
  db.structure.delete(projectId)
  for (const runId of runIds) db.loadTests.delete(runId)
  return { status: 204, data: null }
}

/* ----------------------------------- Runs ----------------------------------- */

function startRun(config: InternalAxiosRequestConfig, projectId: string): MockResponse {
  const project = db.projects.find((item) => item.id === projectId)
  if (!project) return fail(404, 'Project not found')
  const body = readJson<{ loadUsers?: number }>(config) ?? {}
  const loadUsers = body.loadUsers ?? project.settings.defaultLoadUsers
  const isStory = project.id === 'p_booking'
  const run = createRun(project, {
    trigger: 'manual',
    loadUsers,
    expectedChecks: isStory ? EXPECTED_STORY_CHECKS : EXPECTED_CLEAN_CHECKS,
    commitSha: db.commits.find((commit) => commit.projectId === project.id)?.sha,
  })
  db.runs.push(run)
  project.latestRun = summaryOf(run)
  project.updatedAt = new Date().toISOString()
  startRunTimeline(run, isStory ? 'story' : 'clean')
  return ok({ runId: run.id }, 202)
}

function rerun(config: InternalAxiosRequestConfig, runId: string): MockResponse {
  const previous = findRun(runId)
  if (!previous) return fail(404, 'Run not found')
  if (!isTerminal(previous.status)) return fail(409, 'Wait for the current run to finish before rerunning')
  const project = db.projects.find((item) => item.id === previous.projectId)
  if (!project) return fail(404, 'Project not found')
  const body = readJson<{ loadUsers?: number }>(config) ?? {}
  const isStory = project.id === 'p_booking'
  const run = createRun(project, {
    trigger: 'rerun',
    loadUsers: body.loadUsers ?? previous.loadUsers,
    expectedChecks: isStory ? EXPECTED_STORY_CHECKS : EXPECTED_CLEAN_CHECKS,
    previousRunId: previous.id,
    commitSha: db.commits.find((commit) => commit.projectId === project.id)?.sha,
  })
  db.runs.push(run)
  project.latestRun = summaryOf(run)
  project.updatedAt = new Date().toISOString()
  startRunTimeline(run, isStory ? 'rerun' : 'clean')
  return ok({ runId: run.id, previousRunId: previous.id }, 202)
}

function listRunChecks(params: Params, runId: string): MockResponse {
  const run = findRun(runId)
  if (!run) return fail(404, 'Run not found')
  const type = str(params, 'type') as CheckType | undefined
  const items = db.checks
    .filter((check) => check.runId === runId)
    .filter((check) => !type || check.type === type)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  return ok(paginate(items, params))
}

function listRunFindings(params: Params, runId: string): MockResponse {
  const run = findRun(runId)
  if (!run) return fail(404, 'Run not found')
  const severity = str(params, 'severity') as Severity | undefined
  const category = str(params, 'category')
  const clusterId = str(params, 'clusterId')
  const query = str(params, 'query')?.toLowerCase()
  const items = sortFindings(
    db.findings
      .filter((finding) => finding.runId === runId)
      .filter((finding) => !severity || finding.severity === severity)
      .filter((finding) => !category || finding.category === category)
      .filter((finding) => !clusterId || finding.clusterId === clusterId)
      .filter((finding) => !query || finding.title.toLowerCase().includes(query) || (finding.filePath ?? '').toLowerCase().includes(query)),
  )
  return ok(paginate(items, params))
}

/* -------------------------------- Findings ---------------------------------- */

function findingFeedback(config: InternalAxiosRequestConfig, findingId: string): MockResponse {
  const finding = db.findings.find((item) => item.id === findingId)
  if (!finding) return fail(404, 'Finding not found')
  const body = readJson<{ useful?: unknown; fixCorrect?: unknown; comment?: string }>(config)
  if (!body || typeof body.useful !== 'boolean' || typeof body.fixCorrect !== 'boolean') {
    return fail(400, 'Feedback requires boolean "useful" and "fixCorrect" fields')
  }
  const feedback = {
    id: newId('fb'),
    findingId,
    useful: body.useful,
    fixCorrect: body.fixCorrect,
    comment: typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : undefined,
    createdAt: new Date().toISOString(),
  }
  return ok(feedback, 201)
}

function listAllFindings(params: Params): MockResponse {
  const query = str(params, 'query')?.toLowerCase()
  const items = sortFindings(db.findings.filter((finding) => !query || finding.title.toLowerCase().includes(query)))
  return ok(paginate(items, params))
}

/* --------------------------------- Reports ---------------------------------- */

function reportJson(run: Run): unknown {
  const project = db.projects.find((item) => item.id === run.projectId)
  const checks = db.checks.filter((check) => check.runId === run.id)
  const findings = sortFindings(db.findings.filter((finding) => finding.runId === run.id))
  const load = db.loadTests.get(run.id) ?? null
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    product: 'ProofLoop',
    run: {
      id: run.id,
      project: run.projectName,
      status: run.status,
      trigger: run.trigger,
      healthScore: run.healthScore,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      loadUsers: run.loadUsers,
    },
    project: project ? { id: project.id, name: project.name, source: project.source, stack: project.stack } : null,
    checks: {
      total: checks.length,
      passed: checks.filter((check) => check.status === 'passed').length,
      failed: checks.filter((check) => check.status === 'failed').length,
      failedChecks: checks
        .filter((check) => check.status === 'failed')
        .map((check) => ({ name: check.name, command: check.command, message: check.message ?? null })),
    },
    findings: findings.map((finding) => ({
      id: finding.id,
      severity: finding.severity,
      category: finding.category,
      title: finding.title,
      filePath: finding.filePath ?? null,
      confidence: finding.confidence,
      evidenceValidated: finding.evidenceValidated,
      clusterId: finding.clusterId ?? null,
    })),
    loadTest: load,
    notTested: [...new Set(findings.flatMap((finding) => finding.notTested))].slice(0, 20),
  }
}

function escapePdfText(value: string): string {
  return value.replace(/[\\()]/g, (match) => `\\${match}`).replace(/[^\x20-\x7E]/g, '?')
}

/** Minimal, valid one-page PDF with Helvetica text — enough for real viewers. */
function buildPdf(lines: string[]): Blob {
  const content = ['BT', '/F1 11 Tf', '16 TL', '54 730 Td', ...lines.flatMap((line) => [`(${escapePdfText(line)}) Tj`, 'T']), 'ET'].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return new Blob([pdf], { type: 'application/pdf' })
}

function buildReport(run: Run, format: string): MockResponse {
  if (format === 'pdf') {
    const checks = db.checks.filter((check) => check.runId === run.id)
    const findings = sortFindings(db.findings.filter((finding) => finding.runId === run.id))
    const lines = [
      'PROOFLOOP VERIFICATION REPORT',
      '='.repeat(46),
      `Run:          ${run.id}`,
      `Project:      ${run.projectName}`,
      `Status:       ${run.status.toUpperCase()}   Health score: ${run.healthScore ?? '-'} / 100`,
      `Trigger:      ${run.trigger}   Load target: ${run.loadUsers} users`,
      `Started:      ${run.startedAt}`,
      `Finished:     ${run.finishedAt ?? '-'}   Duration: ${Math.round((run.durationMs ?? 0) / 1000)}s`,
      `Checks:       ${checks.filter((c) => c.status === 'passed').length} passed, ${checks.filter((c) => c.status === 'failed').length} failed of ${checks.length}`,
      '',
      'FINDINGS',
      ...findings.map((finding) => `  [${finding.severity.toUpperCase()}] ${finding.title} (confidence ${(finding.confidence * 100).toFixed(0)}%)`),
      '',
      'NOT TESTED',
      ...[...new Set(findings.flatMap((finding) => finding.notTested))].slice(0, 12).map((item) => `  - ${item}`),
      '',
      'Tests decide PASS/FAIL. AI explanations were reviewed against captured evidence.',
    ]
    return ok(buildPdf(lines))
  }
  return ok(new Blob([JSON.stringify(reportJson(run), null, 2)], { type: 'application/json' }))
}

function getArtifact(runId: string, artifactId: string): MockResponse {
  const run = findRun(runId)
  if (!run) return fail(404, 'Run not found')
  if (!artifactCatalog[artifactId]) return fail(404, 'Artifact not found')
  const artifact = buildArtifact(runId, artifactId, run.startedAt)
  if (!artifact) return fail(404, 'Artifact not found')
  const seed = artifactCatalog[artifactId]
  const url =
    seed.kind === 'screenshot'
      ? ADMIN_SCREENSHOT_URL
      : `https://cdn.proofloop.dev/artifacts/${artifactId}?expires=${Math.floor(Date.now() / 1000) + 900}&signature=mock`
  return ok({ artifact, url, content: seed.content })
}

/* ------------------------------- Send to agent ------------------------------ */

function sendToAgent(config: InternalAxiosRequestConfig, runId: string): MockResponse {
  const run = findRun(runId)
  if (!run) return fail(404, 'Run not found')
  const body = readJson<{ agent?: string; findingIds?: string[] }>(config)
  if (!body?.agent || !AGENTS.includes(body.agent as (typeof AGENTS)[number])) {
    return fail(400, `Agent must be one of: ${AGENTS.join(', ')}`)
  }
  if (!Array.isArray(body.findingIds) || body.findingIds.length === 0) {
    return fail(400, 'Select at least one finding to send')
  }
  const existing = body.findingIds.filter((id) => db.findings.some((finding) => finding.id === id))
  if (existing.length === 0) return fail(400, 'None of the selected findings exist')
  return ok(
    {
      agentRunId: newId('agent'),
      agent: body.agent,
      findingCount: existing.length,
      status: 'queued',
    },
    202,
  )
}

/* ------------------------------ Router plumbing ----------------------------- */

export function handleMockRequest(config: InternalAxiosRequestConfig): MockResponse {
  const method = (config.method ?? 'get').toUpperCase()
  const rawUrl = config.url ?? ''
  const path = rawUrl.split('?')[0].replace(/\/+$/, '') || '/'
  const segments = path.split('/').filter(Boolean)
  const params = (config.params ?? {}) as Params

  /* auth */
  if (method === 'GET' && path === '/auth/me') return authMe()
  if (method === 'POST' && path === '/auth/refresh') {
    if (db.loggedOut) return fail(401, 'No active session')
    db.currentUser ??= seedUsers[0]
    return ok({ accessToken: mockToken(), user: db.currentUser })
  }
  if (method === 'POST' && path === '/auth/login') {
    const body = readJson<{ email?: string; password?: string }>(config)
    if (!body?.email || !body.password) return fail(400, 'Email and password are required')
    const user = resolveUser(body.email)
    if (!seedUsers.some((seed) => seed.id === user.id)) db.users.push(user)
    db.currentUser = user
    db.loggedOut = false
    return ok({ accessToken: mockToken(), user })
  }
  if (method === 'POST' && path === '/auth/register') {
    const body = readJson<{ name?: string; email?: string; password?: string }>(config)
    if (!body?.email || !body.password) return fail(400, 'Email and password are required')
    if (body.password.length < 8) return fail(400, 'Password must be at least 8 characters')
    const user = resolveUser(body.email)
    if (body.name) user.name = body.name
    if (!seedUsers.some((seed) => seed.id === user.id)) db.users.push(user)
    db.currentUser = user
    db.loggedOut = false
    return ok({ accessToken: mockToken(), user }, 201)
  }
  if (method === 'POST' && path === '/auth/logout') {
    db.currentUser = null
    db.loggedOut = true
    return ok({ ok: true })
  }

  /* projects */
  if (method === 'GET' && path === '/projects') return listProjects(params)
  if (method === 'POST' && path === '/projects') return createProject(config)
  if (segments[0] === 'projects' && segments.length >= 2) {
    const projectId = segments[1]
    if (method === 'GET' && segments.length === 2) {
      const project = db.projects.find((item) => item.id === projectId)
      return project ? ok(projectSummary(project)) : fail(404, 'Project not found')
    }
    if (method === 'PATCH' && segments.length === 2) return patchProject(config, projectId)
    if (method === 'DELETE' && segments.length === 2) return deleteProject(projectId)
    if (method === 'POST' && segments[2] === 'upload') return uploadProject(config, projectId)
    if (method === 'POST' && segments[2] === 'runs') return startRun(config, projectId)
    if (method === 'GET' && segments[2] === 'structure') {
      const project = db.projects.find((item) => item.id === projectId)
      return project ? ok(structureFor(projectId)) : fail(404, 'Project not found')
    }
    if (method === 'GET' && segments[2] === 'runs') {
      const project = db.projects.find((item) => item.id === projectId)
      if (!project) return fail(404, 'Project not found')
      const items = db.runs
        .filter((run) => run.projectId === projectId)
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      return ok(paginate(items, params))
    }
    if (method === 'GET' && segments[2] === 'commits') {
      const project = db.projects.find((item) => item.id === projectId)
      if (!project) return fail(404, 'Project not found')
      if (segments.length === 4) {
        const sha = segments[3]
        const commit = db.commits.find((item) => item.projectId === projectId && (item.sha === sha || item.shortSha === sha))
        return commit ? ok(commit) : fail(404, 'Commit not found')
      }
      const items = db.commits
        .filter((commit) => commit.projectId === projectId)
        .sort((a, b) => new Date(b.committedAt).getTime() - new Date(a.committedAt).getTime())
      return ok(paginate(items, params))
    }
  }

  /* runs */
  if (segments[0] === 'runs' && segments.length >= 2) {
    const runId = segments[1]
    const run = findRun(runId)
    if (method === 'GET' && segments.length === 2) return run ? ok(run) : fail(404, 'Run not found')
    if (method === 'POST' && segments[2] === 'cancel') {
      if (!run) return fail(404, 'Run not found')
      const cancelled = cancelMockRun(runId)
      return cancelled ? ok(cancelled) : fail(404, 'Run not found')
    }
    if (method === 'POST' && segments[2] === 'rerun') return rerun(config, runId)
    if (method === 'GET' && segments[2] === 'checks') return listRunChecks(params, runId)
    if (method === 'GET' && segments[2] === 'findings') return listRunFindings(params, runId)
    if (method === 'GET' && segments[2] === 'load-test') {
      if (!run) return fail(404, 'Run not found')
      const load = db.loadTests.get(runId)
      if (!load) {
        return ok({
          runId,
          generatedAt: new Date().toISOString(),
          routes: [],
          thresholdErrorRatePct: run ? 5 : 5,
          thresholdP95Ms: 800,
        })
      }
      return ok(load)
    }
    if (method === 'GET' && segments[2] === 'report') {
      if (!run) return fail(404, 'Run not found')
      const format = str(params, 'format') ?? 'json'
      return buildReport(run, format)
    }
    if (method === 'GET' && segments[2] === 'artifacts' && segments.length === 4) {
      return getArtifact(runId, segments[3])
    }
    if (method === 'POST' && segments[2] === 'send-to-agent') return sendToAgent(config, runId)
  }

  /* findings */
  if (segments[0] === 'findings') {
    if (method === 'GET' && segments.length === 1) return listAllFindings(params)
    if (segments.length >= 2) {
      const finding = db.findings.find((item) => item.id === segments[1])
      if (method === 'GET' && segments.length === 2) {
        return finding ? ok(finding) : fail(404, 'Finding not found')
      }
      if (method === 'POST' && segments[2] === 'feedback') return findingFeedback(config, segments[1])
    }
  }

  return fail(404, `No mock handler for ${method} ${path}`)
}
