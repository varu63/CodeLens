import { query } from '../../config/db.js'

export type ArtifactKindRow = 'log' | 'screenshot' | 'trace' | 'report' | 'zip' | 'diff'

export interface ArtifactRow {
  id: string
  runId: string
  checkId: string | null
  name: string
  kind: ArtifactKindRow
  storageUrl: string
  sha256: string | null
  sizeBytes: number | null
  createdAt: Date
}

const ARTIFACT_COLUMNS = `
  id,
  run_id      AS "runId",
  check_id    AS "checkId",
  name,
  kind,
  storage_url AS "storageUrl",
  sha256,
  size_bytes  AS "sizeBytes",
  created_at  AS "createdAt"
`

export async function insertArtifact(input: {
  runId: string
  checkId?: string | null
  name: string
  kind: ArtifactKindRow
  storageUrl: string
  sha256?: string
  sizeBytes: number
}): Promise<ArtifactRow> {
  const result = await query<ArtifactRow>(
    `INSERT INTO artifacts (run_id, check_id, name, kind, storage_url, sha256, size_bytes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${ARTIFACT_COLUMNS}`,
    [
      input.runId,
      input.checkId ?? null,
      input.name,
      input.kind,
      input.storageUrl,
      input.sha256 ?? null,
      input.sizeBytes,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('INSERT INTO artifacts returned no row')
  return row
}

export async function findArtifactById(artifactId: string): Promise<ArtifactRow | null> {
  const result = await query<ArtifactRow>(`SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE id = $1`, [artifactId])
  return result.rows[0] ?? null
}

/** Artifact metadata for a set of checks, keyed by check id. */
export async function artifactsForChecks(checkIds: string[]): Promise<Map<string, ArtifactRow[]>> {
  const map = new Map<string, ArtifactRow[]>()
  if (checkIds.length === 0) return map
  const result = await query<ArtifactRow>(
    `SELECT ${ARTIFACT_COLUMNS} FROM artifacts
      WHERE check_id = ANY($1::uuid[])
      ORDER BY created_at ASC`,
    [checkIds],
  )
  for (const row of result.rows) {
    if (!row.checkId) continue
    const list = map.get(row.checkId) ?? []
    list.push(row)
    map.set(row.checkId, list)
  }
  return map
}
