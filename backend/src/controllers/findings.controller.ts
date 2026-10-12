import type { Request, Response } from 'express'
import { requireUser } from '../middleware/authenticate.js'
import {
  getFindingForUser,
  listAllFindingsForUser,
  listRunFindingsForUser,
  submitFindingFeedback,
} from '../services/findings.service.js'
import type { FindingsPage, FindingsQueryParams } from '../services/findings.service.js'
import type { FeedbackInput, ListFindingsQuery } from '../validators/findings.validators.js'

function pageResponse(result: FindingsPage, query: ListFindingsQuery): {
  items: FindingsPage['items']
  page: number
  limit: number
  total: number
  totalPages: number
} {
  return {
    items: result.items,
    page: query.page,
    limit: query.limit,
    total: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / query.limit)),
  }
}

/** GET /runs/:runId/findings */
export async function listRunFindings(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const query = req.query as unknown as ListFindingsQuery
  const result = await listRunFindingsForUser(
    user.sub,
    req.params.runId ?? '',
    query as FindingsQueryParams,
  )
  res.json(pageResponse(result, query))
}

/** GET /findings — across all projects owned by the caller. */
export async function listAllFindings(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const query = req.query as unknown as ListFindingsQuery
  const result = await listAllFindingsForUser(user.sub, query as FindingsQueryParams)
  res.json(pageResponse(result, query))
}

/** GET /findings/:findingId */
export async function getFinding(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  res.json(await getFindingForUser(user.sub, req.params.findingId ?? ''))
}

/** POST /findings/:findingId/feedback → 201 Feedback */
export async function postFindingFeedback(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const body = req.body as FeedbackInput
  const feedback = await submitFindingFeedback(user.sub, req.params.findingId ?? '', {
    useful: body.useful,
    fixCorrect: body.fixCorrect,
    ...(body.comment ? { comment: body.comment } : {}),
  })
  res.status(201).json(feedback)
}
