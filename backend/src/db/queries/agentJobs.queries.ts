import { query } from '../../config/db.js'

export interface AgentJobRow {
  id: string
  runId: string
  userId: string
  agent: string
  findingIds: string[]
  status: string
  createdAt: Date
}

export interface AgentJobInsert {
  runId: string
  userId: string
  agent: string
  findingIds: string[]
}

/** Handoff record for POST /runs/:runId/send-to-agent. */
export async function insertAgentJob(input: AgentJobInsert): Promise<AgentJobRow> {
  const result = await query<AgentJobRow>(
    `INSERT INTO agent_jobs (run_id, user_id, agent, finding_ids, status)
     VALUES ($1, $2, $3, $4::uuid[], 'queued')
     RETURNING id, run_id AS "runId", user_id AS "userId", agent, finding_ids AS "findingIds",
               status, created_at AS "createdAt"`,
    [input.runId, input.userId, input.agent, input.findingIds],
  )
  const row = result.rows[0]
  if (!row) throw new Error('INSERT INTO agent_jobs returned no row')
  return row
}
