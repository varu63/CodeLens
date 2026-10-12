import { query } from '../../config/db.js'
import type { CheckStatusRow } from './checks.queries.js'

/** The eight pipeline stages, in run order (mirrors the UI stepper). */
export const RUN_STAGE_ORDER = [
  'structure',
  'existing_tests',
  'api_tests',
  'data_fetch',
  'mapping',
  'database',
  'load',
  'security',
] as const

export type RunStageKey = (typeof RUN_STAGE_ORDER)[number]

export interface RunStageRow {
  runId: string
  stage: RunStageKey
  status: CheckStatusRow
  startedAt: Date | null
  finishedAt: Date | null
  message: string | null
}

export async function createRunStages(runId: string): Promise<void> {
  const values = RUN_STAGE_ORDER.map((_, index) => `($1, $${index + 2})`).join(', ')
  await query(
    `INSERT INTO run_stages (run_id, stage) VALUES ${values}
     ON CONFLICT (run_id, stage) DO NOTHING`,
    [runId, ...RUN_STAGE_ORDER],
  )
}

export async function listRunStages(runId: string): Promise<RunStageRow[]> {
  const result = await query<RunStageRow>(
    `SELECT run_id AS "runId", stage, status,
            started_at AS "startedAt", finished_at AS "finishedAt", message
       FROM run_stages WHERE run_id = $1`,
    [runId],
  )
  return result.rows
}

export interface StageUpdate {
  status?: CheckStatusRow
  message?: string
  startedAt?: Date
  finishedAt?: Date
}

export async function updateRunStage(runId: string, stage: RunStageKey, update: StageUpdate): Promise<RunStageRow> {
  const result = await query<RunStageRow>(
    `UPDATE run_stages
        SET status      = COALESCE($3, status),
            message     = COALESCE($4, message),
            started_at  = COALESCE($5, started_at),
            finished_at = COALESCE($6, finished_at)
      WHERE run_id = $1 AND stage = $2
      RETURNING run_id AS "runId", stage, status,
                started_at AS "startedAt", finished_at AS "finishedAt", message`,
    [
      runId,
      stage,
      update.status ?? null,
      update.message ?? null,
      update.startedAt ?? null,
      update.finishedAt ?? null,
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`Run stage ${stage} for run ${runId} disappeared during update`)
  return row
}
