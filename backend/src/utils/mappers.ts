import type { LatestRunRow, RunRow, RunStatusRow } from '../db/queries/runs.queries.js'
import type { CheckRow, CheckStats } from '../db/queries/checks.queries.js'
import type { ArtifactRow } from '../db/queries/artifacts.queries.js'
import type { RunStageKey, RunStageRow } from '../db/queries/runStages.queries.js'
import { RUN_STAGE_ORDER } from '../db/queries/runStages.queries.js'
import type { FindingRow } from '../db/queries/findings.queries.js'
import type { CommitRow } from '../db/queries/commits.queries.js'
import { commitRiskLevel } from '../services/ml.client.js'
import type { LoadResultRow } from '../db/queries/loadResults.queries.js'
import type { ProjectRow, ProjectSettingsRow } from '../db/queries/projects.queries.js'
import type { StructureCounts } from '../db/queries/structures.queries.js'
import type { UserRow } from '../db/queries/users.queries.js'

/** Wire shape the web app expects for a user (see frontend domain.types User). */
export interface ApiUser {
  id: string
  name: string
  email: string
  avatarUrl?: string
  role: 'user' | 'admin'
  createdAt: string
}

export function toApiUser(row: UserRow): ApiUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
    role: row.role,
    createdAt: row.created_at.toISOString(),
  }
}

/* --------------------------------- Projects -------------------------------- */

export interface ApiDetectedStack {
  language: string
  framework: string
  runtime: string
  database: string
  packageManager: string
  frontend?: string
  testFrameworks: string[]
  dependencies: string[]
}

export interface ApiUserSettings {
  defaultLoadUsers: number
  errorRateThresholdPct: number
  p95ThresholdMs: number
}

export interface ApiLatestRun {
  id: string
  status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled'
  healthScore: number | null
  startedAt: string
}

export interface ApiProject {
  id: string
  name: string
  source: 'git' | 'zip' | 'cli'
  gitUrl?: string
  branch?: string
  stack: ApiDetectedStack
  routeCount: number
  tableCount: number
  componentCount: number
  apiCallCount: number
  settings: ApiUserSettings
  latestRun: ApiLatestRun | null
  status: 'created' | 'uploading' | 'scanning' | 'ready' | 'error'
  createdAt: string
  updatedAt: string
}

const DEFAULT_STACK: ApiDetectedStack = {
  language: 'Unknown',
  framework: 'Unknown',
  runtime: 'Node.js',
  database: 'None detected',
  packageManager: 'npm',
  testFrameworks: [],
  dependencies: [],
}

const DEFAULT_SETTINGS: ApiUserSettings = {
  defaultLoadUsers: 100,
  errorRateThresholdPct: 1,
  p95ThresholdMs: 1000,
}

/** DB run statuses include 'error', which the UI folds into 'failed'. */
export function toApiRunStatus(
  status: RunStatusRow,
): 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' {
  if (status === 'error') return 'failed'
  return status
}

export function toApiSettings(settings: ProjectSettingsRow): ApiUserSettings {
  return {
    defaultLoadUsers: settings.loadUsers ?? DEFAULT_SETTINGS.defaultLoadUsers,
    errorRateThresholdPct: settings.thresholds?.errorRatePct ?? DEFAULT_SETTINGS.errorRateThresholdPct,
    p95ThresholdMs: settings.thresholds?.p95Ms ?? DEFAULT_SETTINGS.p95ThresholdMs,
  }
}

export function toApiStack(raw: Record<string, unknown>): ApiDetectedStack {
  const hasKeys = Object.keys(raw).length > 0
  if (!hasKeys) return DEFAULT_STACK
  const read = (key: string, fallback: string): string =>
    typeof raw[key] === 'string' && raw[key] ? (raw[key] as string) : fallback
  const readArray = (key: string): string[] =>
    Array.isArray(raw[key]) ? (raw[key] as unknown[]).filter((item): item is string => typeof item === 'string') : []
  const frontend = typeof raw.frontend === 'string' && raw.frontend ? raw.frontend : undefined
  return {
    language: read('language', DEFAULT_STACK.language),
    framework: read('framework', DEFAULT_STACK.framework),
    runtime: read('runtime', DEFAULT_STACK.runtime),
    database: read('database', DEFAULT_STACK.database),
    packageManager: read('packageManager', DEFAULT_STACK.packageManager),
    ...(frontend ? { frontend } : {}),
    testFrameworks: readArray('testFrameworks'),
    dependencies: readArray('dependencies'),
  }
}

export function toApiLatestRun(row: LatestRunRow): ApiLatestRun {
  return {
    id: row.id,
    status: toApiRunStatus(row.status),
    healthScore: row.healthScore,
    startedAt: row.startedAt.toISOString(),
  }
}

const ZERO_COUNTS: StructureCounts = { routeCount: 0, tableCount: 0, componentCount: 0, apiCallCount: 0 }

export function toApiProject(
  row: ProjectRow,
  counts: StructureCounts = ZERO_COUNTS,
  latestRun: LatestRunRow | null = null,
): ApiProject {
  return {
    id: row.id,
    name: row.name,
    source: row.source === 'upload' ? 'zip' : 'git',
    ...(row.repoUrl ? { gitUrl: row.repoUrl } : {}),
    ...(row.source === 'git' || row.branch ? { branch: row.branch } : {}),
    stack: toApiStack(row.detectedStack),
    routeCount: counts.routeCount,
    tableCount: counts.tableCount,
    componentCount: counts.componentCount,
    apiCallCount: counts.apiCallCount,
    settings: toApiSettings(row.settings ?? {}),
    latestRun: latestRun ? toApiLatestRun(latestRun) : null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/* ----------------------------------- Runs ---------------------------------- */

export interface ApiRunStage {
  stage: RunStageKey
  status: 'queued' | 'running' | 'passed' | 'failed' | 'skipped'
  startedAt?: string
  finishedAt?: string
  message?: string
}

export interface ApiRun {
  id: string
  projectId: string
  projectName: string
  status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled'
  trigger: 'manual' | 'rerun' | 'ci'
  stages: ApiRunStage[]
  healthScore: number | null
  passedChecks: number
  failedChecks: number
  totalChecks: number
  startedAt: string
  finishedAt?: string
  durationMs?: number
  loadUsers: number
  previousRunId?: string
  commitSha?: string
  summary?: string
}

function toApiStageStatus(status: string): ApiRunStage['status'] {
  if (status === 'error') return 'failed'
  return status as ApiRunStage['status']
}

/** Full stage list in pipeline order; missing rows render as 'queued'. */
export function toApiStages(rows: RunStageRow[]): ApiRunStage[] {
  const byStage = new Map(rows.map((row) => [row.stage as RunStageKey, row]))
  return RUN_STAGE_ORDER.map((stage) => {
    const row = byStage.get(stage)
    if (!row) return { stage, status: 'queued' as const }
    return {
      stage,
      status: toApiStageStatus(row.status),
      ...(row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
      ...(row.finishedAt ? { finishedAt: row.finishedAt.toISOString() } : {}),
      ...(row.message ? { message: row.message } : {}),
    }
  })
}

export function toApiRun(row: RunRow, stages: RunStageRow[] | null, stats: CheckStats | null): ApiRun {
  const durationMs =
    row.startedAt && row.finishedAt ? row.finishedAt.getTime() - row.startedAt.getTime() : undefined
  const trigger = row.parentRunId ? 'rerun' : row.environment?.trigger === 'ci' ? 'ci' : 'manual'
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.projectName,
    status: toApiRunStatus(row.status),
    trigger,
    stages: toApiStages(stages ?? []),
    healthScore: row.healthScore,
    passedChecks: stats?.passedChecks ?? 0,
    failedChecks: stats?.failedChecks ?? 0,
    totalChecks: stats?.totalChecks ?? 0,
    startedAt: (row.startedAt ?? row.createdAt).toISOString(),
    ...(row.finishedAt ? { finishedAt: row.finishedAt.toISOString() } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    loadUsers: row.loadUsers,
    ...(row.parentRunId ? { previousRunId: row.parentRunId } : {}),
    ...(row.commitSha ? { commitSha: row.commitSha } : {}),
    ...(row.summary ? { summary: row.summary } : {}),
  }
}

/* ---------------------------------- Checks --------------------------------- */

export interface ApiCheck {
  id: string
  runId: string
  name: string
  type: string
  command: string
  status: 'queued' | 'running' | 'passed' | 'failed' | 'skipped'
  exitCode: number | null
  durationMs: number | null
  artifactIds: string[]
  message?: string
  createdAt: string
}

export function toApiCheck(row: CheckRow, artifacts: ArtifactRow[] = []): ApiCheck {
  return {
    id: row.id,
    runId: row.runId,
    name: row.name,
    type: row.type,
    command: row.command ?? '',
    status: row.status === 'error' ? 'failed' : row.status,
    exitCode: row.exitCode,
    durationMs: row.durationMs,
    artifactIds: artifacts.map((artifact) => artifact.id),
    ...(row.message ? { message: row.message } : {}),
    createdAt: row.createdAt.toISOString(),
  }
}

/* -------------------------------- Artifacts -------------------------------- */

export interface ApiArtifact {
  id: string
  runId: string
  name: string
  kind: 'log' | 'screenshot' | 'report' | 'trace' | 'zip' | 'diff' | 'other'
  sizeBytes: number
  createdAt: string
}

export function toApiArtifact(row: ArtifactRow): ApiArtifact {
  return {
    id: row.id,
    runId: row.runId,
    name: row.name,
    kind: row.kind,
    sizeBytes: row.sizeBytes ?? 0,
    createdAt: row.createdAt.toISOString(),
  }
}

/* --------------------------------- Findings -------------------------------- */

export type ApiSeverity = 'critical' | 'high' | 'medium' | 'low'
export type ApiFindingCategory =
  | 'security'
  | 'api'
  | 'mapping'
  | 'database'
  | 'performance'
  | 'data'
  | 'configuration'

export type ApiFindingEvidence =
  | { kind: 'log'; title?: string; content: string; language?: string }
  | {
      kind: 'http'
      title?: string
      method: string
      url: string
      requestHeaders?: Record<string, string>
      requestBody?: string
      status: number
      statusText?: string
      responseBody: string
      durationMs?: number
    }
  | { kind: 'screenshot'; title?: string; url: string; caption?: string }
  | { kind: 'diff'; title?: string; filePath: string; diff: string }

export interface ApiFinding {
  id: string
  runId: string
  projectId: string
  fingerprint: string
  severity: ApiSeverity
  category: ApiFindingCategory
  title: string
  description: string
  filePath?: string
  line?: number
  endpoint?: string
  table?: string
  clusterId?: string
  clusterSize?: number
  confidence: number
  /** False when the explanation could not be validated against evidence. */
  evidenceValidated: boolean
  evidence: ApiFindingEvidence[]
  whyItMatters: string
  howToFix: string[]
  notTested: string[]
  createdAt: string
}

const FINDING_CATEGORIES: readonly string[] = [
  'security',
  'api',
  'mapping',
  'database',
  'performance',
  'data',
  'configuration',
]

/** `clusterSize` = how many findings in the run share the same root cause. */
export function toApiFinding(row: FindingRow, clusterSize?: number): ApiFinding {
  const category = (FINDING_CATEGORIES.includes(row.category) ? row.category : 'configuration') as ApiFindingCategory
  return {
    id: row.id,
    runId: row.runId,
    projectId: row.projectId,
    fingerprint: row.fingerprint,
    severity: row.severity,
    category,
    title: row.title,
    description: row.description ?? '',
    ...(row.filePath ? { filePath: row.filePath } : {}),
    ...(row.lineNumber !== null ? { line: row.lineNumber } : {}),
    ...(row.endpoint ? { endpoint: row.endpoint } : {}),
    ...(row.dbTable ? { table: row.dbTable } : {}),
    ...(row.clusterId
      ? { clusterId: row.clusterId, ...(clusterSize !== undefined ? { clusterSize } : {}) }
      : {}),
    confidence: row.confidence ?? 1,
    evidenceValidated: row.explained,
    evidence: row.evidenceCache as ApiFindingEvidence[],
    whyItMatters: row.whyItMatters ?? '',
    howToFix: row.fixSteps,
    notTested: row.notTested,
    createdAt: row.createdAt.toISOString(),
  }
}

/* --------------------------------- Commits --------------------------------- */

export interface ApiCommitFile {
  path: string
  change: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
}

export interface ApiCommitRisk {
  /** 0..100, display scale (the DB keeps the 0..1 score). */
  score: number
  level: 'low' | 'medium' | 'high'
  signals: Array<{ label: string; description: string; weight?: number }>
}

/** Wire shape the web app expects for a commit (see frontend domain.types Commit). */
export interface ApiCommit {
  sha: string
  shortSha: string
  projectId: string
  message: string
  llmDescription: string
  author: string
  committedAt: string
  filesChanged: ApiCommitFile[]
  additions: number
  deletions: number
  testsAffected: string[]
  failingTests: string[]
  risk: ApiCommitRisk
  suggestedAction: string
}

export function toApiCommit(row: CommitRow): ApiCommit {
  const score = row.riskScore ?? 0
  return {
    sha: row.sha,
    shortSha: row.sha.slice(0, 7),
    projectId: row.projectId,
    message: row.message ?? '',
    llmDescription: row.description ?? '',
    author: row.author ?? '',
    committedAt: (row.committedAt ?? new Date(0)).toISOString(),
    filesChanged: row.diffSummary?.files ?? [],
    additions: row.linesAdded,
    deletions: row.linesDeleted,
    testsAffected: row.diffSummary?.testsAffected ?? [],
    failingTests: row.diffSummary?.failingTests ?? [],
    risk: {
      score: Math.round(score * 100),
      level: commitRiskLevel(score),
      signals: row.riskSignals ?? [],
    },
    suggestedAction: row.diffSummary?.suggestedAction ?? '',
  }
}

/* ------------------------------- Load results ------------------------------- */

export interface ApiLoadLevel {
  users: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  errorRatePct: number
  requestsPerSecond: number
}

export interface ApiRouteLoadResult {
  route: string
  method: string
  levels: ApiLoadLevel[]
  breakingPointUsers?: number
  peakRps: number
}

export interface ApiLoadTestResult {
  runId: string
  generatedAt: string
  routes: ApiRouteLoadResult[]
  thresholdErrorRatePct: number
  thresholdP95Ms: number
}

/** Groups stored per-level rows into the per-route shape the UI charts read. */
export function toApiLoadTestResult(
  runId: string,
  rows: LoadResultRow[],
  thresholds: { errorRatePct: number; p95Ms: number },
): ApiLoadTestResult {
  const byRoute = new Map<string, LoadResultRow[]>()
  for (const row of rows) {
    const key = `${row.method} ${row.route}`
    const list = byRoute.get(key)
    if (list) list.push(row)
    else byRoute.set(key, [row])
  }

  const routes: ApiRouteLoadResult[] = []
  for (const [, levels] of byRoute) {
    const first = levels[0]
    if (!first) continue
    const breakingLevels = levels.filter((level) => level.isBreakingPoint).map((level) => level.users)
    routes.push({
      route: first.route,
      method: first.method,
      levels: levels.map((level) => ({
        users: level.users,
        p50Ms: level.p50Ms ?? 0,
        p95Ms: level.p95Ms ?? 0,
        p99Ms: level.p99Ms ?? 0,
        errorRatePct: level.errorRatePct ?? 0,
        requestsPerSecond: level.requestsPerSec ?? 0,
      })),
      ...(breakingLevels.length > 0 ? { breakingPointUsers: Math.min(...breakingLevels) } : {}),
      peakRps: Math.max(0, ...levels.map((level) => level.requestsPerSec ?? 0)),
    })
  }
  routes.sort((left, right) => left.route.localeCompare(right.route))

  return {
    runId,
    generatedAt: new Date().toISOString(),
    routes,
    thresholdErrorRatePct: thresholds.errorRatePct,
    thresholdP95Ms: thresholds.p95Ms,
  }
}
