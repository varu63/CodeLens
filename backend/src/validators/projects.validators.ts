import { z } from 'zod'

export const projectIdParamSchema = z.object({
  id: z.string().uuid('Project id must be a UUID'),
})

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(1, 'Project name is required').max(120, 'Project name is too long'),
    gitUrl: z
      .string()
      .trim()
      .regex(/^(https?:\/\/|git@|ssh:\/\/)\S+$/, 'Use an https:// or git@ URL')
      .optional(),
    branch: z.string().trim().min(1).max(200).optional(),
  })
  .strict()

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    settings: z
      .object({
        defaultLoadUsers: z.number().int().min(1).max(10_000).optional(),
        errorRateThresholdPct: z.number().min(0).max(100).optional(),
        p95ThresholdMs: z.number().int().min(1).max(120_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export const listProjectsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().max(200).optional(),
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>
