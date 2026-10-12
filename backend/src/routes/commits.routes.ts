import { Router } from 'express'
import { getProjectCommit, listProjectCommits } from '../controllers/commits.controller.js'
import { authenticate } from '../middleware/authenticate.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { commitParamSchema, listCommitsQuerySchema, projectCommitsParamSchema } from '../validators/commits.validators.js'

/** Mounted at /projects/:projectId/commits — mergeParams exposes the project id. */
export const commitsRouter = Router({ mergeParams: true })

commitsRouter.use(authenticate)
commitsRouter.get(
  '/',
  validate({ params: projectCommitsParamSchema, query: listCommitsQuerySchema }),
  asyncHandler(listProjectCommits),
)
commitsRouter.get('/:sha', validate({ params: commitParamSchema }), asyncHandler(getProjectCommit))
