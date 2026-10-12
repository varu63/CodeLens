/**
 * Server-sent events emitted on GET /runs/:id/stream.
 * Shapes match the web app's RunStreamEvent union exactly.
 */
export interface RunStreamStatusData {
  status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled'
  healthScore: number | null
}

export interface RunStreamStageData {
  stage: string
  status: 'queued' | 'running' | 'passed' | 'failed' | 'skipped'
  startedAt?: string
  finishedAt?: string
  message?: string
}

export type RunStreamEvent =
  | { type: 'status'; data: RunStreamStatusData }
  | { type: 'stage'; data: RunStreamStageData }
  | { type: 'progress'; data: { percent: number } }
  | { type: 'check'; data: unknown }
  | { type: 'finding'; data: unknown }
  | { type: 'load'; data: unknown }
  | { type: 'done'; data: unknown }
