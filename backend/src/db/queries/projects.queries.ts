import { query } from '../../config/db.js'

export type ProjectSource = 'git' | 'upload'
export type ProjectStatus = 'created' | 'uploading' | 'scanning' | 'ready' | 'error'

export interface ProjectRow {
  id: string
  userId: string
  name: string
  source: ProjectSource
  repoUrl: string | null
  branch: string
  storagePath: string | null
  status: ProjectStatus
  detectedStack: Record<string, unknown>
  settings: ProjectSettingsRow
  createdAt: Date
  updatedAt: Date
}

/** Raw shape of the `projects.settings` JSONB column. */
export interface ProjectSettingsRow {
  loadUsers?: number
  thresholds?: {
    errorRatePct?: number
    p95Ms?: number
  }
}

const COLUMNS = `
  id,
  user_id       AS "userId",
  name,
  source,
  repo_url      AS "repoUrl",
  branch,
  storage_path  AS "storagePath",
  status,
  detected_stack AS "detectedStack",
  settings,
  created_at    AS "createdAt",
  updated_at    AS "updatedAt"
`

export async function createProject(input: {
  userId: string
  name: string
  source: ProjectSource
  repoUrl?: string | null
  branch?: string
  storagePath?: string | null
}): Promise<ProjectRow> {
  const result = await query<ProjectRow>(
    `INSERT INTO projects (user_id, name, source, repo_url, branch, storage_path)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [
      input.userId,
      input.name,
      input.source,
      input.repoUrl ?? null,
      input.branch ?? 'main',
      input.storagePath ?? null,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('INSERT INTO projects returned no row')
  return row
}

export async function findProjectById(id: string): Promise<ProjectRow | null> {
  const result = await query<ProjectRow>(`SELECT ${COLUMNS} FROM projects WHERE id = $1`, [id])
  return result.rows[0] ?? null
}

export interface ListProjectsInput {
  userId: string
  page: number
  limit: number
  search?: string
}

export async function listProjects(input: ListProjectsInput): Promise<{ rows: ProjectRow[]; total: number }> {
  const offset = (input.page - 1) * input.limit
  const params: unknown[] = [input.userId]
  let where = 'WHERE user_id = $1'
  if (input.search) {
    params.push(`%${input.search}%`)
    where += ` AND name ILIKE $${params.length}`
  }

  const countResult = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM projects ${where}`,
    params,
  )
  params.push(input.limit, offset)
  const rowsResult = await query<ProjectRow>(
    `SELECT ${COLUMNS} FROM projects ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  )
  return { rows: rowsResult.rows, total: Number(countResult.rows[0]?.total ?? 0) }
}

export async function updateProjectRow(
  id: string,
  changes: {
    name?: string
    status?: ProjectStatus
    detectedStack?: Record<string, unknown>
    storagePath?: string
  },
): Promise<ProjectRow> {
  const result = await query<ProjectRow>(
    `UPDATE projects
        SET name           = COALESCE($2, name),
            status         = COALESCE($3, status),
            detected_stack = COALESCE($4, detected_stack),
            storage_path   = COALESCE($5, storage_path),
            updated_at     = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [
      id,
      changes.name ?? null,
      changes.status ?? null,
      changes.detectedStack ? JSON.stringify(changes.detectedStack) : null,
      changes.storagePath ?? null,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`Project ${id} disappeared during update`)
  return row
}

/** Merges user-facing settings back into the stored JSONB shape. */
export async function updateProjectSettings(
  id: string,
  settings: ProjectSettingsRow,
): Promise<ProjectRow> {
  const result = await query<ProjectRow>(
    `UPDATE projects
        SET settings = settings || $2::jsonb,
            updated_at = now()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [id, JSON.stringify(settings)],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`Project ${id} disappeared during settings update`)
  return row
}

export async function deleteProjectRow(id: string): Promise<void> {
  await query(`DELETE FROM projects WHERE id = $1`, [id])
}

export async function setDetectedStack(id: string, stack: Record<string, unknown>): Promise<void> {
  await query(`UPDATE projects SET detected_stack = $2, updated_at = now() WHERE id = $1`, [
    id,
    JSON.stringify(stack),
  ])
}
