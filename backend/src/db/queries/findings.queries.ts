import { query } from '../../config/db.js'

export type SeverityRow = 'critical' | 'high' | 'medium' | 'low'

/** [{ type: 'check' | 'test_result' | 'artifact' | 'commit', id }] */
export interface EvidenceRef {
  type: 'check' | 'test_result' | 'artifact' | 'commit'
  id: string
}

/** Rendered evidence snapshot the UI displays (mirrors the frontend Evidence union). */
export type EvidencePayload = Record<string, unknown> & { kind: string }

export interface FindingRow {
  id: string
  runId: string
  projectId: string
  clusterId: string | null
  severity: SeverityRow
  category: string
  title: string
  description: string | null
  whyItMatters: string | null
  filePath: string | null
  lineNumber: number | null
  endpoint: string | null
  dbTable: string | null
  fingerprint: string
  evidenceIds: EvidenceRef[]
  fixSteps: string[]
  confidence: number | null
  notTested: string[]
  explained: boolean
  evidenceCache: EvidencePayload[]
  createdAt: Date
}

const FINDING_COLUMNS = `
  f.id,
  f.run_id        AS "runId",
  r.project_id    AS "projectId",
  f.cluster_id    AS "clusterId",
  f.severity,
  f.category,
  f.title,
  f.description,
  f.why_it_matters AS "whyItMatters",
  f.file_path     AS "filePath",
  f.line_number   AS "lineNumber",
  f.endpoint,
  f.db_table      AS "dbTable",
  f.fingerprint,
  f.evidence_ids  AS "evidenceIds",
  f.fix_steps     AS "fixSteps",
  f.confidence::float8 AS "confidence",
  f.not_tested    AS "notTested",
  f.explained,
  f.evidence_cache AS "evidenceCache",
  f.created_at    AS "createdAt"
`

export interface FindingInsert {
  runId: string
  projectId: string
  severity: SeverityRow
  category: string
  title: string
  fingerprint: string
  description?: string
  whyItMatters?: string
  filePath?: string
  lineNumber?: number
  endpoint?: string
  dbTable?: string
  evidenceIds: EvidenceRef[]
  fixSteps?: string[]
  confidence?: number
  notTested?: string[]
  evidenceCache: EvidencePayload[]
}

export async function insertFinding(input: FindingInsert): Promise<FindingRow> {
  const result = await query<FindingRow>(
    `INSERT INTO findings
       (run_id, severity, category, title, description, why_it_matters, file_path, line_number,
        endpoint, db_table, fingerprint, evidence_ids, fix_steps, confidence, not_tested, evidence_cache)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15::jsonb, $16::jsonb)
     RETURNING id, run_id AS "runId", $17::uuid AS "projectId", cluster_id AS "clusterId",
               severity, category, title, description, why_it_matters AS "whyItMatters",
               file_path AS "filePath", line_number AS "lineNumber", endpoint, db_table AS "dbTable",
               fingerprint, evidence_ids AS "evidenceIds", fix_steps AS "fixSteps",
               confidence::float8 AS "confidence", not_tested AS "notTested", explained,
               evidence_cache AS "evidenceCache", created_at AS "createdAt"`,
    [
      input.runId,
      input.severity,
      input.category,
      input.title,
      input.description ?? null,
      input.whyItMatters ?? null,
      input.filePath ?? null,
      input.lineNumber ?? null,
      input.endpoint ?? null,
      input.dbTable ?? null,
      input.fingerprint,
      JSON.stringify(input.evidenceIds),
      JSON.stringify(input.fixSteps ?? []),
      input.confidence ?? null,
      JSON.stringify(input.notTested ?? []),
      JSON.stringify(input.evidenceCache),
      input.projectId,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('INSERT INTO findings returned no row')
  return row
}

export async function findFindingById(findingId: string): Promise<FindingRow | null> {
  const result = await query<FindingRow>(
    `SELECT ${FINDING_COLUMNS} FROM findings f JOIN runs r ON r.id = f.run_id WHERE f.id = $1`,
    [findingId],
  )
  return result.rows[0] ?? null
}

export interface FindingFilters {
  severity?: SeverityRow
  category?: string
  clusterId?: string
  /** Free-text match against title and description. */
  search?: string
  limit: number
  offset: number
}

function findingWhere(filters: FindingFilters, startParam: number): { where: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []
  const next = (value: unknown): string => {
    params.push(value)
    return `$${startParam + params.length - 1}`
  }
  if (filters.severity) conditions.push(`f.severity = ${next(filters.severity)}`)
  if (filters.category) conditions.push(`f.category = ${next(filters.category)}`)
  if (filters.clusterId) conditions.push(`f.cluster_id = ${next(filters.clusterId)}::uuid`)
  if (filters.search) {
    const like = `%${filters.search}%`
    const titleParam = next(like)
    const descriptionParam = next(like)
    conditions.push(`(f.title ILIKE ${titleParam} OR COALESCE(f.description, '') ILIKE ${descriptionParam})`)
  }
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

export async function listFindingsForRun(
  runId: string,
  filters: FindingFilters,
): Promise<{ rows: FindingRow[]; total: number }> {
  const built = findingWhere(filters, 2)
  const params: unknown[] = [runId, ...built.params]
  const where = `WHERE f.run_id = $1 ${built.where ? `AND ${built.where.slice(6)}` : ''}`

  const countResult = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM findings f ${where}`,
    params,
  )
  params.push(filters.limit, filters.offset)
  const rowsResult = await query<FindingRow>(
    `SELECT ${FINDING_COLUMNS}
       FROM findings f JOIN runs r ON r.id = f.run_id
       ${where}
      ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
               f.created_at ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return { rows: rowsResult.rows, total: Number(countResult.rows[0]?.total ?? 0) }
}

/** All findings across every project the user owns. */
export async function listFindingsForUser(
  userId: string,
  filters: FindingFilters,
): Promise<{ rows: FindingRow[]; total: number }> {
  const built = findingWhere(filters, 2)
  const params: unknown[] = [userId, ...built.params]
  const where = `WHERE p.user_id = $1 ${built.where ? `AND ${built.where.slice(6)}` : ''}`
  const from = 'FROM findings f JOIN runs r ON r.id = f.run_id JOIN projects p ON p.id = r.project_id'

  const countResult = await query<{ total: string }>(`SELECT COUNT(*)::text AS total ${from} ${where}`, params)
  params.push(filters.limit, filters.offset)
  const rowsResult = await query<FindingRow>(
    `SELECT ${FINDING_COLUMNS} ${from} ${where}
      ORDER BY CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
               f.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return { rows: rowsResult.rows, total: Number(countResult.rows[0]?.total ?? 0) }
}

export async function findFindingForUser(findingId: string, userId: string): Promise<FindingRow | null> {
  const result = await query<FindingRow>(
    `SELECT ${FINDING_COLUMNS}
       FROM findings f
       JOIN runs r ON r.id = f.run_id
       JOIN projects p ON p.id = r.project_id
      WHERE f.id = $1 AND p.user_id = $2`,
    [findingId, userId],
  )
  return result.rows[0] ?? null
}

export interface SeverityCounts {
  critical: number
  high: number
  medium: number
  low: number
}

export async function severityCountsForRun(runId: string): Promise<SeverityCounts> {
  const result = await query<{ severity: SeverityRow; count: string }>(
    `SELECT severity, COUNT(*)::text AS count FROM findings WHERE run_id = $1 GROUP BY severity`,
    [runId],
  )
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const row of result.rows) counts[row.severity] = Number(row.count)
  return counts
}

/** Fingerprints of every finding on a run — used for fixed/still-failing comparison. */
export async function fingerprintsForRun(runId: string): Promise<Set<string>> {
  const result = await query<{ fingerprint: string }>(
    `SELECT DISTINCT fingerprint FROM findings WHERE run_id = $1 AND fingerprint <> ''`,
    [runId],
  )
  return new Set(result.rows.map((row) => row.fingerprint))
}

/**
 * Cluster membership counts keyed `${runId}|${clusterId}` — the wire layer
 * exposes them as `clusterSize` ("N failures, 1 root cause").
 */
export async function clusterSizesForRuns(runIds: string[]): Promise<Map<string, number>> {
  if (runIds.length === 0) return new Map()
  const result = await query<{ runId: string; clusterId: string; n: string }>(
    `SELECT run_id AS "runId", cluster_id AS "clusterId", COUNT(*)::text AS n
       FROM findings
      WHERE run_id = ANY($1::uuid[]) AND cluster_id IS NOT NULL
      GROUP BY run_id, cluster_id`,
    [runIds],
  )
  return new Map(result.rows.map((row) => [`${row.runId}|${row.clusterId}`, Number(row.n)]))
}

/** Post-analysis annotation: cluster assignment + validated explanation. */
export interface FindingAnnotation {
  clusterId: string | null
  whyItMatters: string
  fixSteps: string[]
  explained: boolean
}

export async function updateFindingAnnotation(
  findingId: string,
  annotation: FindingAnnotation,
): Promise<FindingRow> {
  const result = await query<FindingRow>(
    `UPDATE findings
        SET cluster_id     = $2::uuid,
            why_it_matters = $3,
            fix_steps      = $4::jsonb,
            explained      = $5
      WHERE id = $1
      RETURNING id, run_id AS "runId", (SELECT project_id FROM runs WHERE id = run_id) AS "projectId",
                cluster_id AS "clusterId", severity, category, title, description,
                why_it_matters AS "whyItMatters", file_path AS "filePath",
                line_number AS "lineNumber", endpoint, db_table AS "dbTable", fingerprint,
                evidence_ids AS "evidenceIds", fix_steps AS "fixSteps",
                confidence::float8 AS "confidence", not_tested AS "notTested", explained,
                evidence_cache AS "evidenceCache", created_at AS "createdAt"`,
    [findingId, annotation.clusterId, annotation.whyItMatters, JSON.stringify(annotation.fixSteps), annotation.explained],
  )
  const row = result.rows[0]
  if (!row) throw new Error('UPDATE findings returned no row')
  return row
}

/** Subset of the given ids that actually belong to the run (for agent handoff). */
export async function findFindingIdsForRun(runId: string, findingIds: string[]): Promise<string[]> {
  if (findingIds.length === 0) return []
  const result = await query<{ id: string }>(
    'SELECT id FROM findings WHERE run_id = $1 AND id = ANY($2::uuid[])',
    [runId, findingIds],
  )
  return result.rows.map((row) => row.id)
}

/* --------------------------------- Feedback -------------------------------- */

export interface FeedbackRow {
  id: string
  findingId: string
  useful: boolean
  fixCorrect: boolean
  comment: string | null
  createdAt: Date
}

export interface FeedbackUpsert {
  findingId: string
  userId: string
  useful: boolean
  fixCorrect: boolean
  comment?: string
}

/** One feedback row per (finding, user); re-submitting updates the same row. */
export async function upsertFindingFeedback(input: FeedbackUpsert): Promise<FeedbackRow> {
  const result = await query<FeedbackRow>(
    `INSERT INTO feedback (finding_id, user_id, useful, fix_correct, comment)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (finding_id, user_id) DO UPDATE SET
       useful      = EXCLUDED.useful,
       fix_correct = EXCLUDED.fix_correct,
       comment     = EXCLUDED.comment
     RETURNING id, finding_id AS "findingId", useful, fix_correct AS "fixCorrect",
               comment, created_at AS "createdAt"`,
    [input.findingId, input.userId, input.useful, input.fixCorrect, input.comment ?? null],
  )
  const row = result.rows[0]
  if (!row) throw new Error('INSERT INTO feedback returned no row')
  return row
}
