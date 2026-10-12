import { query } from '../../config/db.js'

export interface LoadResultRow {
  id: string
  runId: string
  route: string
  method: string
  users: number
  avgMs: number | null
  p50Ms: number | null
  p95Ms: number | null
  p99Ms: number | null
  errorRatePct: number | null
  requestsPerSec: number | null
  dbConnectionErrors: number
  isBreakingPoint: boolean
  bottleneck: string | null
}

export interface LoadResultInsert {
  runId: string
  route: string
  method: string
  users: number
  avgMs: number | null
  p50Ms: number | null
  p95Ms: number | null
  p99Ms: number | null
  errorRatePct: number | null
  requestsPerSec: number | null
  dbConnectionErrors?: number
  isBreakingPoint: boolean
  bottleneck?: string | null
}

export async function insertLoadResult(input: LoadResultInsert): Promise<void> {
  await query(
    `INSERT INTO load_results
       (run_id, route, method, users, avg_ms, p50_ms, p95_ms, p99_ms,
        error_rate, requests_per_sec, db_connection_errors, is_breaking_point, bottleneck)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      input.runId,
      input.route,
      input.method,
      input.users,
      input.avgMs,
      input.p50Ms,
      input.p95Ms,
      input.p99Ms,
      input.errorRatePct,
      input.requestsPerSec,
      input.dbConnectionErrors ?? 0,
      input.isBreakingPoint,
      input.bottleneck ?? null,
    ],
  )
}

export async function listLoadResultsForRun(runId: string): Promise<LoadResultRow[]> {
  const result = await query<LoadResultRow>(
    `SELECT id,
            run_id          AS "runId",
            route,
            method,
            users,
            avg_ms::float8  AS "avgMs",
            p50_ms::float8  AS "p50Ms",
            p95_ms::float8  AS "p95Ms",
            p99_ms::float8  AS "p99Ms",
            error_rate::float8       AS "errorRatePct",
            requests_per_sec::float8 AS "requestsPerSec",
            db_connection_errors     AS "dbConnectionErrors",
            is_breaking_point        AS "isBreakingPoint",
            bottleneck
       FROM load_results
      WHERE run_id = $1
      ORDER BY route ASC, users ASC`,
    [runId],
  )
  return result.rows
}
