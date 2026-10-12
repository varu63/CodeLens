import { z } from 'zod'

export const projectCommitsParamSchema = z.object({
  projectId: z.string().uuid('Project id must be a UUID'),
})

export const commitParamSchema = z.object({
  projectId: z.string().uuid('Project id must be a UUID'),
  sha: z.string().regex(/^[0-9a-fA-F]{7,40}$/, 'Commit sha must be 7-40 hex characters'),
})

export const listCommitsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type ListCommitsQuery = z.infer<typeof listCommitsQuerySchema>
