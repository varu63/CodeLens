import { query } from '../../config/db.js'
import type { RiskSignal } from '../../services/ml.client.js'

/** Minimal for evidence validation now; the commits API extends this in its step. */
export async function commitExists(commitId: string): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    'SELECT EXISTS(SELECT 1 FROM commits WHERE id = $1) AS exists',
    [commitId],
  )
  return result.rows[0]?.exists === true
}

export interface CommitFileRow {
  path: string
  change: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
}

export interface CommitDiffSummary {
  files: CommitFileRow[]
  testsAffected: string[]
  hotspots: string[]
  suggestedAction: string
  failingTests: string[]
}

export interface CommitRow {
  id: string
  projectId: string
  sha: string
  message: string | null
  author: string | null
  committedAt: Date | null
  filesChanged: number
  linesAdded: number
  linesDeleted: number
  diffSummary: CommitDiffSummary | null
  /** 0..1 */
  riskScore: number | null
  riskSignals: RiskSignal[]
  description: string | null
}

const COMMIT_COLUMNS = `
  c.id,
  c.project_id      AS "projectId",
  c.sha,
  c.message,
  c.author,
  c.committed_at    AS "committedAt",
  c.files_changed   AS "filesChanged",
  c.lines_added     AS "linesAdded",
  c.lines_deleted   AS "linesDeleted",
  c.diff_summary    AS "diffSummary",
  c.risk_score::float8 AS "riskScore",
  c.risk_signals    AS "riskSignals",
  c.description
`

export interface UpsertCommitInput {
  projectId: string
  sha: string
  message: string | null
  author: string | null
  committedAt: Date | null
  filesChanged: number
  linesAdded: number
  linesDeleted: number
  diffSummary: CommitDiffSummary
  riskScore: number
  riskSignals: RiskSignal[]
  description: string
}

/** Re-analysis refreshes the row in place; (project_id, sha) is the identity. */
export async function upsertCommit(input: UpsertCommitInput): Promise<CommitRow> {
  const result = await query<CommitRow>(
    `INSERT INTO commits
       (project_id, sha, message, author, committed_at, files_changed, lines_added,
        lines_deleted, diff_summary, risk_score, risk_signals, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12)
     ON CONFLICT (project_id, sha) DO UPDATE SET
       message       = EXCLUDED.message,
       author        = EXCLUDED.author,
       committed_at  = EXCLUDED.committed_at,
       files_changed = EXCLUDED.files_changed,
       lines_added   = EXCLUDED.lines_added,
       lines_deleted = EXCLUDED.lines_deleted,
       diff_summary  = EXCLUDED.diff_summary,
       risk_score    = EXCLUDED.risk_score,
       risk_signals  = EXCLUDED.risk_signals,
       description   = EXCLUDED.description
     RETURNING id, project_id AS "projectId", sha, message, author,
               committed_at AS "committedAt", files_changed AS "filesChanged",
               lines_added AS "linesAdded", lines_deleted AS "linesDeleted",
               diff_summary AS "diffSummary", risk_score::float8 AS "riskScore",
               risk_signals AS "riskSignals", description`,
    [
      input.projectId,
      input.sha,
      input.message,
      input.author,
      input.committedAt,
      input.filesChanged,
      input.linesAdded,
      input.linesDeleted,
      JSON.stringify(input.diffSummary),
      input.riskScore,
      JSON.stringify(input.riskSignals),
      input.description,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('INSERT INTO commits returned no row')
  return row
}

export async function listCommitsForProject(
  projectId: string,
  options: { limit: number; offset: number },
): Promise<CommitRow[]> {
  const result = await query<CommitRow>(
    `SELECT ${COMMIT_COLUMNS}
       FROM commits c
      WHERE c.project_id = $1
      ORDER BY c.committed_at DESC NULLS LAST
      LIMIT $2 OFFSET $3`,
    [projectId, options.limit, options.offset],
  )
  return result.rows
}

export async function countCommitsForProject(projectId: string): Promise<number> {
  const result = await query<{ count: string }>(
    'SELECT count(*)::text AS count FROM commits WHERE project_id = $1',
    [projectId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

/** Exact sha first, then a prefix match so short SHAs from the UI resolve too. */
export async function findCommitForProject(projectId: string, sha: string): Promise<CommitRow | null> {
  const result = await query<CommitRow>(
    `SELECT ${COMMIT_COLUMNS}
       FROM commits c
      WHERE c.project_id = $1 AND (c.sha = $2 OR c.sha LIKE $2 || '%')
      ORDER BY (c.sha = $2) DESC, c.committed_at DESC NULLS LAST
      LIMIT 1`,
    [projectId, sha],
  )
  return result.rows[0] ?? null
}
