import { Router } from 'express'
import { getFinding, listAllFindings, postFindingFeedback } from '../controllers/findings.controller.js'
import { authenticate } from '../middleware/authenticate.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  feedbackSchema,
  findingIdParamSchema,
  listFindingsQuerySchema,
} from '../validators/findings.validators.js'

export const findingsRouter = Router()

findingsRouter.use(authenticate)

findingsRouter.get('/', validate({ query: listFindingsQuerySchema }), asyncHandler(listAllFindings))
findingsRouter.get('/:findingId', validate({ params: findingIdParamSchema }), asyncHandler(getFinding))
findingsRouter.post(
  '/:findingId/feedback',
  validate({ params: findingIdParamSchema, body: feedbackSchema }),
  asyncHandler(postFindingFeedback),
)
