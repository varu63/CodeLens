import { z } from 'zod'

export const findingIdParamSchema = z.object({
  findingId: z.string().uuid('Finding id must be a UUID'),
})

export const listFindingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  category: z
    .enum(['security', 'api', 'mapping', 'database', 'performance', 'data', 'configuration'])
    .optional(),
  clusterId: z.string().uuid().optional(),
  /** Free-text search across title and description (frontend sends `query`). */
  query: z.string().min(1).max(200).optional(),
})

export const feedbackSchema = z
  .object({
    useful: z.boolean(),
    fixCorrect: z.boolean(),
    comment: z.string().trim().max(2000).optional(),
  })
  .strict()

export type ListFindingsQuery = z.infer<typeof listFindingsQuerySchema>
export type FeedbackInput = z.infer<typeof feedbackSchema>
