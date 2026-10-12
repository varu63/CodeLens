/**
 * Domain models used across the ProofLoop UI.
 * These mirror the backend entities; wire-level DTOs live in api.types.ts.
 */

export type Role = 'user' | 'admin'

export interface User {
  id: string
  email: string
  name: string
  avatarUrl?: string
  role: Role
  createdAt: string
}

export interface UserSettings {
  defaultLoadUsers: number
  errorRateThresholdPct: number
  p95ThresholdMs: number
}

/* ------------------------------- Projects -------------------------------- */

export type ProjectSource = 'git' | 'zip' | 'cli'

export interface DetectedStack {
  language: string
  framework: string
  runtime: string
  database: string
  packageManager: string
  frontend?: string
  testFrameworks: string[]
  dependencies: string[]
}

export interface Project {
  id: string
  name: string
  source: ProjectSource
  gitUrl?: string
  branch?: string
  stack: DetectedStack
  routeCount: number
  tableCount: number
  componentCount: number
  apiCallCount: number
  settings: UserSettings
  latestRun: LatestRunSummary | null
  createdAt: string
  updatedAt: string
}

export interface LatestRunSummary {
  id: string
  status: RunStatus
  healthScore: number | null
  startedAt: string
}

/* ----------------------------- Structure map ------------------------------ */

export type AuthLevel = 'public' | 'user' | 'admin' | 'none-detected'

export interface EndpointInfo {
  method: string
  path: string
  file: string
  auth: AuthLevel
  /** Set when verification found a problem with this endpoint (e.g. 404 in tests). */
  issue?: string
}

export interface TableColumnInfo {
  name: string
  type: string
  nullable?: boolean
}

export interface TableInfo {
  name: string
  columns: TableColumnInfo[]
  relations: string[]
}

export type ComponentKind = 'page' | 'component' | 'hook' | 'service' | 'context'

export interface ComponentInfo {
  name: string
  path: string
  kind: ComponentKind
}

export interface ApiCallInfo {
  from: string
  method: string
  path: string
  status: 'ok' | 'broken'
  note?: string
}

export interface StructureMap {
  routes: EndpointInfo[]
  tables: TableInfo[]
  components: ComponentInfo[]
  apiCalls: ApiCallInfo[]
}

/* ---------------------------------- Runs ---------------------------------- */

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled'
export type CheckStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped'

export type RunStageKey =
  | 'structure'
  | 'existing_tests'
  | 'api_tests'
  | 'data_fetch'
  | 'mapping'
  | 'database'
  | 'load'
  | 'security'

export const RUN_STAGE_ORDER: RunStageKey[] = [
  'structure',
  'existing_tests',
  'api_tests',
  'data_fetch',
  'mapping',
  'database',
  'load',
  'security',
]

export interface RunStageProgress {
  stage: RunStageKey
  status: CheckStatus
  startedAt?: string
  finishedAt?: string
  message?: string
}

export type RunTrigger = 'manual' | 'rerun' | 'ci'

export interface Run {
  id: string
  projectId: string
  projectName: string
  status: RunStatus
  trigger: RunTrigger
  stages: RunStageProgress[]
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

export type CheckType =
  | 'structure'
  | 'existing_tests'
  | 'api'
  | 'e2e'
  | 'data_fetch'
  | 'data_mapping'
  | 'db'
  | 'load'
  | 'security'

export interface Check {
  id: string
  runId: string
  name: string
  type: CheckType
  command: string
  status: CheckStatus
  exitCode: number | null
  durationMs: number | null
  artifactIds: string[]
  message?: string
  createdAt: string
}

/* ------------------------------- Load tests -------------------------------- */

export interface LoadLevelResult {
  users: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
  errorRatePct: number
  requestsPerSecond: number
}

export interface RouteLoadResult {
  route: string
  method: string
  levels: LoadLevelResult[]
  breakingPointUsers?: number
  peakRps: number
}

export interface LoadTestResult {
  runId: string
  generatedAt: string
  routes: RouteLoadResult[]
  thresholdErrorRatePct: number
  thresholdP95Ms: number
}

/* -------------------------------- Findings --------------------------------- */

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export type FindingCategory =
  | 'security'
  | 'api'
  | 'mapping'
  | 'database'
  | 'performance'
  | 'data'
  | 'configuration'

export type ComparisonStatus = 'fixed' | 'still_failing' | 'new'

export interface LogEvidence {
  kind: 'log'
  title?: string
  content: string
  language?: string
}

export interface HttpEvidence {
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

export interface ScreenshotEvidence {
  kind: 'screenshot'
  title?: string
  url: string
  caption?: string
}

export interface DiffEvidence {
  kind: 'diff'
  title?: string
  filePath: string
  diff: string
}

export type Evidence = LogEvidence | HttpEvidence | ScreenshotEvidence | DiffEvidence

export interface Finding {
  id: string
  runId: string
  projectId: string
  /** Stable identity across runs, used to compute fixed / still-failing / new. */
  fingerprint: string
  severity: Severity
  category: FindingCategory
  title: string
  description: string
  filePath?: string
  line?: number
  endpoint?: string
  table?: string
  clusterId?: string
  clusterSize?: number
  /** 0..1 — how strongly the models believe this is a real issue. */
  confidence: number
  /** False when the evidence could not be validated (shown as "Unexplained"). */
  evidenceValidated: boolean
  evidence: Evidence[]
  whyItMatters: string
  howToFix: string[]
  notTested: string[]
  comparisonStatus?: ComparisonStatus
  createdAt: string
}

/* --------------------------------- Commits --------------------------------- */

export type CommitChange = 'added' | 'modified' | 'deleted' | 'renamed'

export interface CommitFile {
  path: string
  change: CommitChange
  additions: number
  deletions: number
}

export interface RiskSignal {
  label: string
  description: string
  weight?: number
}

export interface CommitRisk {
  score: number
  level: 'low' | 'medium' | 'high'
  signals: RiskSignal[]
}

export interface Commit {
  sha: string
  shortSha: string
  projectId: string
  message: string
  llmDescription: string
  author: string
  committedAt: string
  filesChanged: CommitFile[]
  additions: number
  deletions: number
  testsAffected: string[]
  failingTests: string[]
  risk: CommitRisk
  suggestedAction: string
}

/* -------------------------------- Artifacts -------------------------------- */

export type ArtifactKind = 'log' | 'screenshot' | 'report' | 'trace' | 'zip' | 'diff' | 'other'

export interface Artifact {
  id: string
  runId: string
  name: string
  kind: ArtifactKind
  sizeBytes: number
  createdAt: string
}

/* -------------------------------- Feedback --------------------------------- */

export interface Feedback {
  id: string
  findingId: string
  useful: boolean
  fixCorrect: boolean
  comment?: string
  createdAt: string
}
