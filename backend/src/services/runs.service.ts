import { existsSync, readFileSync } from 'node:fs'
import { insertAgentJob } from '../db/queries/agentJobs.queries.js'
import { checkStatsForRun, createCheck, listChecksForRun } from '../db/queries/checks.queries.js'
import type { CheckTypeRow } from '../db/queries/checks.queries.js'
import { findCommitForProject } from '../db/queries/commits.queries.js'
import { findFindingIdsForRun } from '../db/queries/findings.queries.js'
import { findArtifactById, artifactsForChecks } from '../db/queries/artifacts.queries.js'
import { listLoadResultsForRun } from '../db/queries/loadResults.queries.js'
import { findProjectById } from '../db/queries/projects.queries.js'
import { createRun, findRunById, listRunsForProject, updateRun } from '../db/queries/runs.queries.js'
import type { RunRow, RunStatusRow } from '../db/queries/runs.queries.js'
import { createRunStages, listRunStages } from '../db/queries/runStages.queries.js'
import { getObjectText, signedGetUrl } from '../config/storage.js'
import { enqueueRun, removeQueuedRun } from '../queue/queues.js'
import { badRequest, notFound } from '../utils/errors.js'
import { assertOwned } from '../utils/ownership.js'
import { toApiArtifact, toApiCheck, toApiLoadTestResult, toApiRun } from '../utils/mappers.js'
import type { ApiArtifact, ApiCheck, ApiLoadTestResult, ApiRun } from '../utils/mappers.js'
import { STAGE_SPECS, streamSnapshot } from './run.pipeline.js'
import { getOwnedProject } from './project.service.js'
import { runEvents } from './sse.service.js'
import { workspaceDir } from './workspace.service.js'

const TERMINAL_STATUSES: RunStatusRow[] = ['passed', 'failed', 'cancelled', 'error']

export function isTerminalStatus(status: RunStatusRow): boolean {
  return TERMINAL_STATUSES.includes(status)
}

async function buildApiRun(row: RunRow): Promise<ApiRun> {
  const [stages, stats] = await Promise.all([listRunStages(row.id), checkStatsForRun(row.id)])
  return toApiRun(row, stages, stats)
}

export async function getRunRowForUser(userId: string, runId: string): Promise<RunRow> {
  const row = await findRunById(runId)
  if (!row) throw notFound('Run not found')
  return assertOwned({ ...row, userId: row.projectUserId }, userId, 'Run')
}

export async function getRunForUser(userId: string, runId: string): Promise<ApiRun> {
  const row = await getRunRowForUser(userId, runId)
  return buildApiRun(row)
}

export interface StartRunResult {
  run: ApiRun
}

export async function startRunForProject(
  userId: string,
  projectId: string,
  input: { loadUsers?: number; checks?: CheckTypeRow[]; commit?: string },
): Promise<StartRunResult> {
  const project = await getOwnedProject(userId, projectId)

  if (project.status === 'created' || project.status === 'uploading') {
    throw badRequest('Upload a source archive before starting a run.', 'PROJECT_EMPTY')
  }
  if (project.status === 'scanning') {
    throw badRequest('The project is still being scanned. Try again in a moment.', 'PROJECT_SCANNING')
  }
  if (!existsSync(workspaceDir(projectId))) {
    throw badRequest('Project sources are missing on disk. Re-upload or re-clone the project.', 'WORKSPACE_MISSING')
  }

  const loadUsers = input.loadUsers ?? project.settings.loadUsers ?? 100

  let commitSha = readHeadCommit(projectId)
  if (input.commit) {
    const commit = await findCommitForProject(projectId, input.commit)
    if (!commit) {
      throw badRequest(
        'Unknown commit for this project. Start one verification first so the history is analysed.',
        'UNKNOWN_COMMIT',
      )
    }
    commitSha = commit.sha.slice(0, 12)
  }

  const run = await createRun({
    projectId,
    triggeredBy: userId,
    loadUsers,
    commitSha,
    ...(input.checks && input.checks.length > 0 ? { environment: { checks: input.checks } } : {}),
  })
  await createRunStages(run.id)
  for (const spec of STAGE_SPECS) {
    await createCheck({
      runId: run.id,
      type: spec.type as CheckTypeRow,
      name: spec.name,
      sortOrder: STAGE_SPECS.indexOf(spec) + 1,
    })
  }

  await enqueueRun(run.id, projectId)
  return { run: await buildApiRun(run) }
}

/** Best-effort short SHA of the project's checked-out commit. */
function readHeadCommit(projectId: string): string | null {
  try {
    const head = readFileSync(`${workspaceDir(projectId)}/.git/HEAD`, 'utf8').trim()
    if (head.startsWith('ref: ')) {
      const ref = head.slice('ref: '.length)
      const sha = readFileSync(`${workspaceDir(projectId)}/.git/${ref}`, 'utf8').trim()
      return sha.slice(0, 12)
    }
    return head.slice(0, 12)
  } catch {
    return null
  }
}

export interface ListRunsResult {
  items: ApiRun[]
  total: number
}

export async function listRunsForUser(
  userId: string,
  projectId: string,
  params: { page: number; limit: number; status?: RunStatusRow },
): Promise<ListRunsResult> {
  await getOwnedProject(userId, projectId)
  const { rows, total } = await listRunsForProject({
    projectId,
    page: params.page,
    limit: params.limit,
    ...(params.status ? { status: params.status } : {}),
  })
  const items = await Promise.all(rows.map((row) => buildApiRun(row)))
  return { items, total }
}

export interface ListChecksResult {
  items: ApiCheck[]
  total: number
}

export async function listChecksForUser(
  userId: string,
  runId: string,
  params: { page: number; limit: number; type?: CheckTypeRow },
): Promise<ListChecksResult> {
  await getRunRowForUser(userId, runId)
  const { rows, total } = await listChecksForRun(runId, {
    limit: params.limit,
    offset: (params.page - 1) * params.limit,
    ...(params.type ? { type: params.type } : {}),
  })
  const artifactMap = await artifactsForChecks(rows.map((row) => row.id))
  return {
    items: rows.map((row) => toApiCheck(row, artifactMap.get(row.id) ?? [])),
    total,
  }
}

/**
 * Load-test results for a run in the shape the charts read. Thresholds come
 * from the project settings so the UI draws the same judgement lines the
 * pipeline used.
 */
export async function getLoadTestForUser(userId: string, runId: string): Promise<ApiLoadTestResult> {
  const row = await getRunRowForUser(userId, runId)
  const [results, project] = await Promise.all([
    listLoadResultsForRun(runId),
    findProjectById(row.projectId),
  ])
  const thresholds = {
    errorRatePct: project?.settings.thresholds?.errorRatePct ?? 1,
    p95Ms: project?.settings.thresholds?.p95Ms ?? 1000,
  }
  return toApiLoadTestResult(runId, results, thresholds)
}

export async function cancelRunForUser(userId: string, runId: string): Promise<ApiRun> {
  const row = await getRunRowForUser(userId, runId)
  if (isTerminalStatus(row.status)) {
    throw badRequest('This run has already finished.', 'RUN_FINISHED')
  }

  await removeQueuedRun(runId)
  await updateRun(runId, { status: 'cancelled', finishedAt: new Date(), summary: 'Cancelled by user' })

  runEvents.publish(runId, { type: 'status', data: { status: 'cancelled', healthScore: row.healthScore } })

  const fresh = await findRunById(runId)
  const apiRun = fresh ? await buildApiRun(fresh) : await buildApiRun(row)

  // The worker stops between stages; when nothing is executing, close the stream here.
  runEvents.publish(runId, { type: 'done', data: apiRun })
  return apiRun
}

export interface RerunResult {
  run: ApiRun
  previousRunId: string
}

export async function rerunForUser(
  userId: string,
  runId: string,
  input: { loadUsers?: number },
): Promise<RerunResult> {
  const original = await getRunRowForUser(userId, runId)

  const run = await createRun({
    projectId: original.projectId,
    triggeredBy: userId,
    parentRunId: original.id,
    commitSha: original.commitSha,
    loadUsers: input.loadUsers ?? original.loadUsers,
    environment: original.environment,
  })
  await createRunStages(run.id)
  for (const spec of STAGE_SPECS) {
    await createCheck({
      runId: run.id,
      type: spec.type as CheckTypeRow,
      name: spec.name,
      sortOrder: STAGE_SPECS.indexOf(spec) + 1,
    })
  }
  await enqueueRun(run.id, original.projectId)
  return { run: await buildApiRun(run), previousRunId: original.id }
}

/* --------------------------------- Artifacts -------------------------------- */

const INLINE_CONTENT_LIMIT = 256 * 1024

export interface ArtifactWithUrl {
  artifact: ApiArtifact
  url: string
  content?: string
}

export async function getArtifactForUser(
  userId: string,
  runId: string,
  artifactId: string,
): Promise<ArtifactWithUrl> {
  await getRunRowForUser(userId, runId)
  const artifact = await findArtifactById(artifactId)
  if (!artifact || artifact.runId !== runId) throw notFound('Artifact not found')

  const url = await signedGetUrl(artifact.storageUrl)
  const apiArtifact = toApiArtifact(artifact)

  let content: string | undefined
  const inlineable = artifact.kind === 'log' || artifact.kind === 'report' || artifact.kind === 'diff'
  if (inlineable && (artifact.sizeBytes ?? 0) <= INLINE_CONTENT_LIMIT && !artifact.storageUrl.startsWith('inline:')) {
    content = (await getObjectText(artifact.storageUrl)) ?? undefined
  }

  return { artifact: apiArtifact, url, ...(content !== undefined ? { content } : {}) }
}

/* ----------------------------------- SSE ------------------------------------ */

export interface StreamHandle {
  close: () => void
}

/**
 * Writes the SSE frame format the web client parses:
 *   event: <type>\n data: <json>\n\n  (+ comment heartbeats)
 * Replays a snapshot first so late subscribers see current progress.
 * The caller must have verified ownership and set SSE headers already.
 */
export async function openRunStream(
  run: RunRow,
  write: (chunk: string) => void,
  onEnd: () => void,
): Promise<StreamHandle> {
  const runId = run.id
  const send = (event: { type: string; data: unknown }): void => {
    write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
  }

  const { events } = await streamSnapshot(run)
  for (const event of events) send(event)

  if (isTerminalStatus(run.status)) {
    send({ type: 'done', data: await buildApiRun(run) })
    onEnd()
    return { close: () => undefined }
  }

  let heartbeat: ReturnType<typeof setInterval> | null = setInterval(() => {
    write(': ping\n\n')
  }, 15_000)
  heartbeat.unref?.()

  const unsubscribe = runEvents.subscribe(runId, (event) => {
    send(event)
    if (event.type === 'done') {
      cleanup()
      onEnd()
    }
  })

  const cleanup = (): void => {
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
    unsubscribe()
  }

  // The run may have finished between the snapshot read and subscribing.
  const fresh = await findRunById(runId)
  if (!fresh || isTerminalStatus(fresh.status)) {
    if (!runEvents.isFinished(runId) && fresh) {
      send({ type: 'done', data: await buildApiRun(fresh) })
    }
    cleanup()
    onEnd()
    return { close: cleanup }
  }

  return { close: cleanup }
}

/* ------------------------------ Send to agent ------------------------------ */

export type AgentKind = 'claude_code' | 'codex' | 'cursor' | 'aider'

export interface SendToAgentResult {
  agentRunId: string
  /** The queued agent_jobs row; same id as agentRunId under the spec's name too. */
  agentJobId: string
  agent: AgentKind
  findingCount: number
  status: 'queued'
}

/** Queues a handoff of selected findings to a coding agent (202 + job id). */
export async function sendRunToAgentForUser(
  userId: string,
  runId: string,
  input: { agent: AgentKind; findingIds: string[] },
): Promise<SendToAgentResult> {
  const run = await getRunRowForUser(userId, runId)

  const validIds = await findFindingIdsForRun(run.id, input.findingIds)
  if (validIds.length === 0) {
    throw badRequest('None of the selected findings exist', 'NO_VALID_FINDINGS')
  }

  const job = await insertAgentJob({
    runId: run.id,
    userId,
    agent: input.agent,
    findingIds: validIds,
  })
  return {
    agentRunId: job.id,
    agentJobId: job.id,
    agent: input.agent,
    findingCount: validIds.length,
    status: 'queued',
  }
}