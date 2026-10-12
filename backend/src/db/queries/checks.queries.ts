import { query } from '../../config/db.js'

export type CheckTypeRow =
  | 'structure'
  | 'existing_tests'
  | 'api'
  | 'e2e'
  | 'data_fetch'
  | 'data_mapping'
  | 'db'
  | 'load'
  | 'security'

export type CheckStatusRow = 'queued' | 'running' | 'passed' | 'failed' | 'skipped' | 'error'

export interface CheckRow {
  id: string
  runId: string
  type: CheckTypeRow
  name: string
  command: string | null
  exitCode: number | null
  durationMs: number | null
  status: CheckStatusRow
  message: string | null
  sortOrder: number
  startedAt: Date | null
  finishedAt: Date | null
  createdAt: Date
}

const CHECK_COLUMNS = `
  id,
  run_id        AS "runId",
  type,
  name,
  command,
  exit_code     AS "exitCode",
  duration_ms   AS "durationMs",
  status,
  message,
  sort_order    AS "sortOrder",
  started_at    AS "startedAt",
  finished_at   AS "finishedAt",
  created_at    AS "createdAt"
`

export async function createCheck(input: {
  runId: string
  type: CheckTypeRow
  name: string
  sortOrder: number
  command?: string
}): Promise<CheckRow> {
  const result = await query<CheckRow>(
    `INSERT INTO checks (run_id, type, name, command, sort_order, status)
     VALUES ($1, $2, $3, $4, $5, 'queued')
     RETURNING ${CHECK_COLUMNS}`,
    [input.runId, input.type, input.name, input.command ?? null, input.sortOrder],
  )
  const row = result.rows[0]
  if (!row) throw new Error('INSERT INTO checks returned no row')
  return row
}

export async function findCheckById(checkId: string): Promise<CheckRow | null> {
  const result = await query<CheckRow>(`SELECT ${CHECK_COLUMNS} FROM checks WHERE id = $1`, [checkId])
  return result.rows[0] ?? null
}

export async function listChecksForRun(
  runId: string,
  filters: { type?: CheckTypeRow; limit: number; offset: number },
): Promise<{ rows: CheckRow[]; total: number }> {
  const params: unknown[] = [runId]
  let where = 'WHERE run_id = $1'
  if (filters.type) {
    params.push(filters.type)
    where += ` AND type = $${params.length}`
  }
  const countResult = await query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM checks ${where}`, params)
  params.push(filters.limit, filters.offset)
  const rowsResult = await query<CheckRow>(
    `SELECT ${CHECK_COLUMNS} FROM checks ${where}
      ORDER BY sort_order ASC, created_at ASC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return { rows: rowsResult.rows, total: Number(countResult.rows[0]?.total ?? 0) }
}

export interface CheckUpdate {
  status?: CheckStatusRow
  message?: string
  command?: string
  exitCode?: number | null
  durationMs?: number
  startedAt?: Date
  finishedAt?: Date
}

export async function updateCheck(checkId: string, update: CheckUpdate): Promise<CheckRow> {
  const result = await query<CheckRow>(
    `UPDATE checks
        SET status      = COALESCE($2, status),
            message     = COALESCE($3, message),
            command     = COALESCE($4, command),
            exit_code   = COALESCE($5, exit_code),
            duration_ms = COALESCE($6, duration_ms),
            started_at  = COALESCE($7, started_at),
            finished_at = COALESCE($8, finished_at)
      WHERE id = $1
      RETURNING ${CHECK_COLUMNS}`,
    [
      checkId,
      update.status ?? null,
      update.message ?? null,
      update.command ?? null,
      update.exitCode === undefined ? null : update.exitCode,
      update.durationMs ?? null,
      update.startedAt ?? null,
      update.finishedAt ?? null,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`Check ${checkId} disappeared during update`)
  return row
}

export interface CheckStats {
  passedChecks: number
  failedChecks: number
  totalChecks: number
}

/** Evidence validation helper: a finding may cite a test result that must exist. */
export async function testResultExists(testResultId: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM test_results WHERE id = $1) AS exists',
    [testResultId],
  )
  return result.rows[0]?.exists === true
}

export async function checkStatsForRun(runId: string): Promise<CheckStats> {
  const result = await query<{ passed: string; failed: string; total: string }>(
    `SELECT
        COUNT(*) FILTER (WHERE status = 'passed')::text                AS passed,
        COUNT(*) FILTER (WHERE status IN ('failed', 'error'))::text    AS failed,
        COUNT(*)::text                                                 AS total
       FROM checks WHERE run_id = $1`,
    [runId],
  )
  const row = result.rows[0]
  return {
    passedChecks: Number(row?.passed ?? 0),
    failedChecks: Number(row?.failed ?? 0),
    totalChecks: Number(row?.total ?? 0),
  }
}
