import { z } from 'zod'

export const runIdParamSchema = z.object({
  runId: z.string().uuid('Run id must be a UUID'),
})

export const artifactParamSchema = z.object({
  runId: z.string().uuid('Run id must be a UUID'),
  artifactId: z.string().uuid('Artifact id must be a UUID'),
})

export const RUNNABLE_CHECK_TYPES = [
  'structure',
  'existing_tests',
  'api',
  'data_fetch',
  'data_mapping',
  'db',
  'load',
  'security',
] as const

export const startRunSchema = z
  .object({
    loadUsers: z.number().int().min(1).max(10_000).optional(),
    /** When present, only these stages execute; the rest are marked skipped. */
    checks: z.array(z.enum(RUNNABLE_CHECK_TYPES)).min(1).max(RUNNABLE_CHECK_TYPES.length).optional(),
    /** Associate the run with a previously analysed commit (full or short sha). */
    commit: z
      .string()
      .regex(/^[0-9a-fA-F]{7,40}$/, 'Commit sha must be 7-40 hex characters')
      .optional(),
  })
  .strict()

/** Reruns copy the original run's configuration; only load users may change. */
export const rerunSchema = z
  .object({
    loadUsers: z.number().int().min(1).max(10_000).optional(),
  })
  .strict()

export const listRunsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['queued', 'running', 'passed', 'failed', 'cancelled', 'error']).optional(),
})

export const listChecksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  type: z
    .enum(['structure', 'existing_tests', 'api', 'e2e', 'data_fetch', 'data_mapping', 'db', 'load', 'security'])
    .optional(),
})

export const AGENT_KINDS = ['claude_code', 'codex', 'cursor', 'aider'] as const

/** Hand a curated finding set to a coding agent for automated fixing. */
export const sendToAgentSchema = z
  .object({
    agent: z.enum(AGENT_KINDS),
    findingIds: z.array(z.string().uuid('Finding id must be a UUID')).min(1).max(50),
  })
  .strict()

export const reportQuerySchema = z.object({
  format: z.enum(['json', 'pdf']).default('json'),
})

export type StartRunInput = z.infer<typeof startRunSchema>
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>
export type ListChecksQuery = z.infer<typeof listChecksQuerySchema>
export type SendToAgentInput = z.infer<typeof sendToAgentSchema>
export type ReportQuery = z.infer<typeof reportQuerySchema>
