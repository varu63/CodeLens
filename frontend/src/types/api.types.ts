/**
 * Request / response DTOs for every ProofLoop API endpoint.
 * Base path for all endpoints: {VITE_API_URL} (default http://localhost:5000/api/v1).
 */

import type {
  Artifact,
  Check,
  CheckType,
  Commit,
  ComparisonStatus,
  Feedback,
  Finding,
  FindingCategory,
  LoadTestResult,
  Project,
  Run,
  RunStageProgress,
  RunStatus,
  Severity,
  StructureMap,
  User,
  UserSettings,
} from './domain.types'

/* --------------------------------- Shared ---------------------------------- */

export interface Paginated<T> {
  items: T[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface PageParams {
  page?: number
  limit?: number
}

/* ----------------------------------- Auth ---------------------------------- */

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  name: string
  email: string
  password: string
}

export interface AuthResponse {
  accessToken: string
  user: User
}

export interface RefreshResponse {
  accessToken: string
  user?: User
}

export type MeResponse = User

/* --------------------------------- Projects -------------------------------- */

export interface CreateProjectRequest {
  name: string
  /** Omit for zip uploads — the archive is attached via POST /projects/:id/upload. */
  gitUrl?: string
  branch?: string
}

export type ProjectResponse = Project

export interface ProjectsListParams extends PageParams {
  query?: string
}

export type ProjectsListResponse = Paginated<Project>

export interface UpdateProjectRequest {
  name?: string
  settings?: Partial<UserSettings>
}

export interface UploadProjectResponse {
  project: Project
  filesDetected: number
  bytesUploaded: number
}

export type StructureResponse = StructureMap

/* ----------------------------------- Runs ---------------------------------- */

export interface StartRunRequest {
  loadUsers?: number
}

export interface StartRunResponse {
  runId: string
}

export type RunResponse = Run

export interface RunsListParams extends PageParams {
  status?: RunStatus
}

export type RunsListResponse = Paginated<Run>

export interface ChecksListParams extends PageParams {
  type?: CheckType
}

export type ChecksListResponse = Paginated<Check>

export type LoadTestResponse = LoadTestResult

export interface RerunResponse {
  runId: string
  previousRunId: string
}

export type CancelRunResponse = Run

export type ReportFormat = 'json' | 'pdf'

export interface ArtifactResponse {
  artifact: Artifact
  /** Short-lived signed URL for direct download / viewing. */
  url: string
  /** Inline content when the artifact is small text (e.g. logs). */
  content?: string
}

export type AgentKind = 'claude_code' | 'codex' | 'cursor' | 'aider'

export interface AgentInfo {
  id: AgentKind
  name: string
  description: string
}

export interface SendToAgentRequest {
  agent: AgentKind
  findingIds: string[]
}

export interface SendToAgentResponse {
  agentRunId: string
  agent: AgentKind
  findingCount: number
  status: 'queued' | 'running'
}

/** Server-sent events emitted on GET /runs/:id/stream. */
export type RunStreamEvent =
  | { type: 'status'; data: { status: RunStatus; healthScore: number | null } }
  | { type: 'stage'; data: RunStageProgress }
  | { type: 'progress'; data: { percent: number } }
  | { type: 'check'; data: Check }
  | { type: 'finding'; data: Finding }
  | { type: 'load'; data: LoadTestResult }
  | { type: 'done'; data: Run }

/* --------------------------------- Findings -------------------------------- */

export interface FindingsListParams extends PageParams {
  severity?: Severity
  category?: FindingCategory
  clusterId?: string
  query?: string
}

export type FindingsListResponse = Paginated<Finding>

export type FindingResponse = Finding

export interface FeedbackRequest {
  useful: boolean
  fixCorrect: boolean
  comment?: string
}

export type FeedbackResponse = Feedback

/* --------------------------------- Commits --------------------------------- */

export type CommitsListParams = PageParams

export type CommitsListResponse = Paginated<Commit>

export type CommitResponse = Commit

/* ------------------------- Run comparison (client-side) -------------------- */

export interface RunComparisonBucket {
  status: ComparisonStatus
  findings: Finding[]
}
