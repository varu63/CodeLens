import { query } from '../../config/db.js'

export type RunStatusRow = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'error'

export interface LatestRunRow {
  projectId: string
  id: string
  status: RunStatusRow
  healthScore: number | null
  startedAt: Date
}

export interface RunRow {
  id: string
  projectId: string
  projectUserId: string
  projectName: string
  triggeredBy: string | null
  parentRunId: string | null
  commitSha: string | null
  status: RunStatusRow
  loadUsers: number
  healthScore: number | null
  environment: Record<string, unknown>
  summary: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

const RUN_COLUMNS = `
  r.id,
  r.project_id      AS "projectId",
  p.user_id         AS "projectUserId",
  p.name            AS "projectName",
  r.triggered_by    AS "triggeredBy",
  r.parent_run_id   AS "parentRunId",
  r.commit_sha      AS "commitSha",
  r.status,
  r.load_users      AS "loadUsers",
  r.health_score::float8 AS "healthScore",
  r.environment,
  r.summary,
  r.created_at      AS "createdAt",
  r.started_at      AS "startedAt",
  r.finished_at     AS "finishedAt"
`

export async function createRun(input: {
  projectId: string
  triggeredBy: string
  parentRunId?: string | null
  commitSha?: string | null
  loadUsers: number
  environment?: Record<string, unknown>
}): Promise<RunRow> {
  const result = await query<RunRow>(
    `INSERT INTO runs (project_id, triggered_by, parent_run_id, commit_sha, load_users, status, environment)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6::jsonb)
     RETURNING id, project_id AS "projectId",
               (SELECT user_id FROM projects WHERE id = $1) AS "projectUserId",
               (SELECT name FROM projects WHERE id = $1)    AS "projectName",
               triggered_by AS "triggeredBy", parent_run_id AS "parentRunId",
               commit_sha AS "commitSha", status, load_users AS "loadUsers",
               NULL::float8 AS "healthScore", environment, summary,
               created_at AS "createdAt", started_at AS "startedAt", finished_at AS "finishedAt"`,
    [
      input.projectId,
      input.triggeredBy,
      input.parentRunId ?? null,
      input.commitSha ?? null,
      input.loadUsers,
      JSON.stringify(input.environment ?? {}),
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('INSERT INTO runs returned no row')
  return row
}

export async function findRunById(runId: string): Promise<RunRow | null> {
  const result = await query<RunRow>(
    `SELECT ${RUN_COLUMNS}
       FROM runs r JOIN projects p ON p.id = r.project_id
      WHERE r.id = $1`,
    [runId],
  )
  return result.rows[0] ?? null
}

export interface ListRunsInput {
  projectId: string
  page: number
  limit: number
  status?: RunStatusRow
}

export async function listRunsForProject(input: ListRunsInput): Promise<{ rows: RunRow[]; total: number }> {
  const params: unknown[] = [input.projectId]
  let where = 'WHERE r.project_id = $1'
  if (input.status) {
    params.push(input.status)
    where += ` AND r.status = $${params.length}`
  }

  const countResult = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM runs r ${where}`,
    params,
  )
  const offset = (input.page - 1) * input.limit
  params.push(input.limit, offset)
  const rowsResult = await query<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM runs r JOIN projects p ON p.id = r.project_id ${where}
      ORDER BY r.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return { rows: rowsResult.rows, total: Number(countResult.rows[0]?.total ?? 0) }
}

export interface RunUpdate {
  status?: RunStatusRow
  healthScore?: number | null
  summary?: string
  environment?: Record<string, unknown>
  startedAt?: Date
  finishedAt?: Date
}

export async function updateRun(runId: string, update: RunUpdate): Promise<void> {
  await query(
    `UPDATE runs
        SET status       = COALESCE($2, status),
            health_score = COALESCE($3, health_score),
            summary      = COALESCE($4, summary),
            environment  = COALESCE($5::jsonb, environment),
            started_at   = COALESCE($6, started_at),
            finished_at  = COALESCE($7, finished_at)
      WHERE id = $1`,
    [
      runId,
      update.status ?? null,
      update.healthScore === undefined ? null : update.healthScore,
      update.summary ?? null,
      update.environment ? JSON.stringify(update.environment) : null,
      update.startedAt ?? null,
      update.finishedAt ?? null,
    ],
  )
}

/** Most recent run of one project. */
export async function findLatestRunForProject(projectId: string): Promise<LatestRunRow | null> {
  const result = await query<LatestRunRow>(
    `SELECT project_id        AS "projectId",
            id,
            status,
            health_score::float8 AS "healthScore",
            COALESCE(started_at, created_at) AS "startedAt"
       FROM runs
      WHERE project_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [projectId],
  )
  return result.rows[0] ?? null
}

/** Most recent run per project, for the project cards / list. */
export async function latestRunsForProjects(projectIds: string[]): Promise<Map<string, LatestRunRow>> {
  const latest = new Map<string, LatestRunRow>()
  if (projectIds.length === 0) return latest

  const result = await query<LatestRunRow>(
    `SELECT DISTINCT ON (project_id)
            project_id        AS "projectId",
            id,
            status,
            health_score::float8 AS "healthScore",
            COALESCE(started_at, created_at) AS "startedAt"
       FROM runs
      WHERE project_id = ANY($1::uuid[])
      ORDER BY project_id, created_at DESC`,
    [projectIds],
  )
  for (const row of result.rows) latest.set(row.projectId, row)
  return latest
}
