import { query } from '../../config/db.js'

export interface StructureMapData {
  routes: Array<{ method: string; path: string; file: string; auth: string; issue?: string }>
  tables: Array<{
    name: string
    columns: Array<{ name: string; type: string; nullable?: boolean }>
    relations: string[]
  }>
  components: Array<{ name: string; path: string; kind: string }>
  apiCalls: Array<{ from: string; method: string; path: string; status: 'ok' | 'broken'; note?: string }>
}

export const EMPTY_STRUCTURE: StructureMapData = { routes: [], tables: [], components: [], apiCalls: [] }

export interface StructureRow {
  projectId: string
  data: StructureMapData
  updatedAt: Date
}

export async function upsertStructure(projectId: string, data: StructureMapData): Promise<void> {
  await query(
    `INSERT INTO structures (project_id, data, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (project_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [projectId, JSON.stringify(data)],
  )
}

export async function findStructure(projectId: string): Promise<StructureRow | null> {
  const result = await query<{ projectId: string; data: StructureMapData; updatedAt: Date }>(
    `SELECT project_id AS "projectId", data, updated_at AS "updatedAt"
       FROM structures WHERE project_id = $1`,
    [projectId],
  )
  return result.rows[0] ?? null
}

export interface StructureCounts {
  routeCount: number
  tableCount: number
  componentCount: number
  apiCallCount: number
}

/** Counts derived from the stored structure JSONB, for many projects at once. */
export async function structureCountsForProjects(
  projectIds: string[],
): Promise<Map<string, StructureCounts>> {
  const counts = new Map<string, StructureCounts>()
  if (projectIds.length === 0) return counts

  const result = await query<{
    projectId: string
    routeCount: number
    tableCount: number
    componentCount: number
    apiCallCount: number
  }>(
    `SELECT project_id AS "projectId",
            jsonb_array_length(COALESCE(data->'routes', '[]'::jsonb))     AS "routeCount",
            jsonb_array_length(COALESCE(data->'tables', '[]'::jsonb))     AS "tableCount",
            jsonb_array_length(COALESCE(data->'components', '[]'::jsonb)) AS "componentCount",
            jsonb_array_length(COALESCE(data->'apiCalls', '[]'::jsonb))   AS "apiCallCount"
       FROM structures
      WHERE project_id = ANY($1::uuid[])`,
    [projectIds],
  )
  for (const row of result.rows) {
    counts.set(row.projectId, {
      routeCount: row.routeCount,
      tableCount: row.tableCount,
      componentCount: row.componentCount,
      apiCallCount: row.apiCallCount,
    })
  }
  return counts
}

/** Updates the data-fetch status of specific frontend calls (used by checks). */
export async function updateApiCallStatus(
  projectId: string,
  updates: Array<{ path: string; status: 'ok' | 'broken'; note?: string }>,
): Promise<void> {
  const current = await findStructure(projectId)
  if (!current) return
  const byPath = new Map(updates.map((update) => [update.path, update]))
  const data: StructureMapData = {
    ...current.data,
    apiCalls: current.data.apiCalls.map((call) => {
      const update = byPath.get(call.path)
      if (!update) return call
      return { ...call, status: update.status, ...(update.note ? { note: update.note } : {}) }
    }),
  }
  await upsertStructure(projectId, data)
}

/** Attaches a problem note to specific routes (e.g. 5xx during checks). */
export async function updateRouteIssues(
  projectId: string,
  updates: Array<{ method: string; path: string; issue: string }>,
): Promise<void> {
  if (updates.length === 0) return
  const current = await findStructure(projectId)
  if (!current) return
  const byRoute = new Map(updates.map((update) => [`${update.method} ${update.path}`, update]))
  const data: StructureMapData = {
    ...current.data,
    routes: current.data.routes.map((route) => {
      const update = byRoute.get(`${route.method} ${route.path}`)
      if (!update) return route
      return { ...route, issue: update.issue }
    }),
  }
  await upsertStructure(projectId, data)
}
