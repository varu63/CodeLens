import type { Request, Response } from 'express'
import { requireUser } from '../middleware/authenticate.js'
import { getProjectCommitForUser, listProjectCommitsForUser } from '../services/commit.service.js'
import type { ListCommitsQuery } from '../validators/commits.validators.js'

/** GET /projects/:id/commits */
export async function listProjectCommits(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const query = req.query as unknown as ListCommitsQuery
  const result = await listProjectCommitsForUser(user.sub, req.params.projectId ?? '', {
    page: query.page,
    limit: query.limit,
  })
  res.json({
    items: result.items,
    page: query.page,
    limit: query.limit,
    total: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / query.limit)),
  })
}

/** GET /projects/:id/commits/:sha (short SHAs resolve to their full commit) */
export async function getProjectCommit(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  res.json(await getProjectCommitForUser(user.sub, req.params.projectId ?? '', req.params.sha ?? ''))
}
