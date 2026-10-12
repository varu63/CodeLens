import { createHash } from 'node:crypto'
import { findArtifactById } from '../db/queries/artifacts.queries.js'
import { findCheckById, testResultExists } from '../db/queries/checks.queries.js'
import { commitExists } from '../db/queries/commits.queries.js'
import {
  clusterSizesForRuns,
  findFindingForUser,
  insertFinding,
  listFindingsForRun,
  listFindingsForUser,
  upsertFindingFeedback,
} from '../db/queries/findings.queries.js'
import type {
  EvidencePayload,
  EvidenceRef,
  FindingFilters,
  FindingRow,
  SeverityRow,
} from '../db/queries/findings.queries.js'
import { findRunById } from '../db/queries/runs.queries.js'
import { toApiFinding } from '../utils/mappers.js'
import type { ApiFinding, ApiFindingCategory } from '../utils/mappers.js'
import { notFound } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { assertOwned } from '../utils/ownership.js'
import { annotateFinding } from './analysis.service.js'
import { runEvents } from './sse.service.js'

export interface FindingInput {
  runId: string
  projectId: string
  severity: SeverityRow
  category: 'security' | 'api' | 'mapping' | 'database' | 'performance' | 'data' | 'configuration'
  title: string
  description?: string
  whyItMatters?: string
  fixSteps?: string[]
  notTested?: string[]
  filePath?: string
  lineNumber?: number
  endpoint?: string
  dbTable?: string
  confidence?: number
  /** Real evidence references — every one is verified to exist before insert. */
  evidenceRefs: EvidenceRef[]
  /** Rendered snapshot the UI shows for those references. */
  evidence: EvidencePayload[]
}

/**
 * Stable identity across runs: the same underlying problem keeps its hash so
 * reruns can classify findings as fixed / still-failing / new.
 */
function fingerprintOf(input: FindingInput): string {
  const basis = [
    input.category,
    input.title,
    input.filePath ?? '',
    input.endpoint ?? '',
    input.dbTable ?? '',
  ]
    .join('|')
    .toLowerCase()
  return createHash('sha256').update(basis).digest('hex').slice(0, 32)
}

async function refExists(ref: EvidenceRef, runId: string): Promise<boolean> {
  switch (ref.type) {
    case 'artifact': {
      const artifact = await findArtifactById(ref.id)
      return Boolean(artifact && artifact.runId === runId)
    }
    case 'check': {
      const check = await findCheckById(ref.id)
      return Boolean(check && check.runId === runId)
    }
    case 'test_result':
      return testResultExists(ref.id)
    case 'commit':
      return commitExists(ref.id)
  }
}

/**
 * Creates a finding and publishes it on the live run stream.
 *
 * Golden rule: a finding without at least one *existing* evidence reference is
 * not persisted — checks that cannot prove something never emit findings.
 */
export async function createFinding(input: FindingInput): Promise<FindingRow | null> {
  const validRefs: EvidenceRef[] = []
  for (const ref of input.evidenceRefs) {
    if (await refExists(ref, input.runId)) {
      validRefs.push(ref)
    } else {
      logger.warn({ runId: input.runId, ref, title: input.title }, 'Dropped evidence ref that does not exist')
    }
  }
  if (validRefs.length === 0) {
    logger.warn({ runId: input.runId, title: input.title }, 'Finding skipped: no verifiable evidence')
    return null
  }

  const row = await insertFinding({
    runId: input.runId,
    projectId: input.projectId,
    severity: input.severity,
    category: input.category,
    title: input.title,
    fingerprint: fingerprintOf(input),
    ...(input.description ? { description: input.description } : {}),
    ...(input.whyItMatters ? { whyItMatters: input.whyItMatters } : {}),
    ...(input.filePath ? { filePath: input.filePath } : {}),
    ...(input.lineNumber !== undefined ? { lineNumber: input.lineNumber } : {}),
    ...(input.endpoint ? { endpoint: input.endpoint } : {}),
    ...(input.dbTable ? { dbTable: input.dbTable } : {}),
    evidenceIds: validRefs,
    ...(input.fixSteps ? { fixSteps: input.fixSteps } : {}),
    confidence: input.confidence ?? 1,
    ...(input.notTested ? { notTested: input.notTested } : {}),
    evidenceCache: input.evidence,
  })

  // Cluster + explanation (stubbed while ML_ENABLED=false); never fails the finding.
  const annotated = await annotateFinding(row)

  let clusterSize: number | undefined
  if (annotated.clusterId) {
    const sizes = await clusterSizesForRuns([annotated.runId])
    clusterSize = sizes.get(`${annotated.runId}|${annotated.clusterId}`) ?? 1
  }
  runEvents.publish(input.runId, { type: 'finding', data: toApiFinding(annotated, clusterSize) })
  return annotated
}

/** Creates findings one by one, swallowing individual failures. */
export async function createFindings(inputs: FindingInput[]): Promise<FindingRow[]> {
  const created: FindingRow[] = []
  for (const input of inputs) {
    try {
      const row = await createFinding(input)
      if (row) created.push(row)
    } catch (error) {
      logger.error({ err: error, title: input.title }, 'Could not persist finding')
    }
  }
  return created
}

/* ------------------------------ Read side ---------------------------------- */

export interface FindingsPage {
  items: ApiFinding[]
  total: number
}

export interface FindingsQueryParams {
  page: number
  limit: number
  severity?: SeverityRow
  category?: ApiFindingCategory
  clusterId?: string
  /** Free-text search across title and description. */
  query?: string
}

function toFilters(params: FindingsQueryParams): FindingFilters {
  return {
    ...(params.severity ? { severity: params.severity } : {}),
    ...(params.category ? { category: params.category } : {}),
    ...(params.clusterId ? { clusterId: params.clusterId } : {}),
    ...(params.query ? { search: params.query } : {}),
    limit: params.limit,
    offset: (params.page - 1) * params.limit,
  }
}

/** Findings for one run; the run must belong to the caller (404 otherwise). */
export async function listRunFindingsForUser(
  userId: string,
  runId: string,
  params: FindingsQueryParams,
): Promise<FindingsPage> {
  const run = await findRunById(runId)
  assertOwned(run ? { ...run, userId: run.projectUserId } : null, userId, 'Run')
  const { rows, total } = await listFindingsForRun(runId, toFilters(params))
  const sizes = await clusterSizesForRuns([runId])
  return {
    items: rows.map((row) =>
      toApiFinding(row, row.clusterId ? (sizes.get(`${row.runId}|${row.clusterId}`) ?? 1) : undefined),
    ),
    total,
  }
}

/** Findings across every project the caller owns. */
export async function listAllFindingsForUser(
  userId: string,
  params: FindingsQueryParams,
): Promise<FindingsPage> {
  const { rows, total } = await listFindingsForUser(userId, toFilters(params))
  const sizes = await clusterSizesForRuns([...new Set(rows.map((row) => row.runId))])
  return {
    items: rows.map((row) =>
      toApiFinding(row, row.clusterId ? (sizes.get(`${row.runId}|${row.clusterId}`) ?? 1) : undefined),
    ),
    total,
  }
}

export async function getFindingForUser(userId: string, findingId: string): Promise<ApiFinding> {
  const row = await findFindingForUser(findingId, userId)
  if (!row) throw notFound('Finding not found')
  let clusterSize: number | undefined
  if (row.clusterId) {
    const sizes = await clusterSizesForRuns([row.runId])
    clusterSize = sizes.get(`${row.runId}|${row.clusterId}`) ?? 1
  }
  return toApiFinding(row, clusterSize)
}

/* -------------------------------- Feedback --------------------------------- */

export interface FeedbackInput {
  useful: boolean
  fixCorrect: boolean
  comment?: string
}

export interface ApiFeedback {
  id: string
  findingId: string
  useful: boolean
  fixCorrect: boolean
  comment?: string
  createdAt: string
}

/** Records whether a finding was useful / the fix was correct (one per user). */
export async function submitFindingFeedback(
  userId: string,
  findingId: string,
  input: FeedbackInput,
): Promise<ApiFeedback> {
  const finding = await findFindingForUser(findingId, userId)
  if (!finding) throw notFound('Finding not found')

  // TODO(ml): feed this human label into the finding-ranking model's retraining
  // set served at ML_SERVICE_URL /ml/feedback (labels: useful, fixCorrect).
  const row = await upsertFindingFeedback({
    findingId,
    userId,
    useful: input.useful,
    fixCorrect: input.fixCorrect,
    ...(input.comment ? { comment: input.comment } : {}),
  })
  return {
    id: row.id,
    findingId: row.findingId,
    useful: row.useful,
    fixCorrect: row.fixCorrect,
    ...(row.comment ? { comment: row.comment } : {}),
    createdAt: row.createdAt.toISOString(),
  }
}
