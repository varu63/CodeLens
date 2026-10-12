import { Router } from 'express'
import {
  cancelRun,
  getRun,
  getRunArtifact,
  getRunLoadTest,
  getRunReport,
  listRunChecks,
  listRunFindings,
  rerunRun,
  sendRunToAgent,
  streamRun,
} from '../controllers/runs.controller.js'
import { authenticate } from '../middleware/authenticate.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { listFindingsQuerySchema } from '../validators/findings.validators.js'
import {
  artifactParamSchema,
  listChecksQuerySchema,
  reportQuerySchema,
  rerunSchema,
  runIdParamSchema,
  sendToAgentSchema,
} from '../validators/runs.validators.js'

export const runsRouter = Router()

runsRouter.use(authenticate)

runsRouter.get('/:runId', validate({ params: runIdParamSchema }), asyncHandler(getRun))
runsRouter.get('/:runId/stream', validate({ params: runIdParamSchema }), asyncHandler(streamRun))
runsRouter.get(
  '/:runId/checks',
  validate({ params: runIdParamSchema, query: listChecksQuerySchema }),
  asyncHandler(listRunChecks),
)
runsRouter.get(
  '/:runId/load-test',
  validate({ params: runIdParamSchema }),
  asyncHandler(getRunLoadTest),
)
runsRouter.get(
  '/:runId/findings',
  validate({ params: runIdParamSchema, query: listFindingsQuerySchema }),
  asyncHandler(listRunFindings),
)
runsRouter.get(
  '/:runId/report',
  validate({ params: runIdParamSchema, query: reportQuerySchema }),
  asyncHandler(getRunReport),
)
runsRouter.post('/:runId/cancel', validate({ params: runIdParamSchema }), asyncHandler(cancelRun))
runsRouter.post(
  '/:runId/rerun',
  validate({ params: runIdParamSchema, body: rerunSchema }),
  asyncHandler(rerunRun),
)
runsRouter.post(
  '/:runId/send-to-agent',
  validate({ params: runIdParamSchema, body: sendToAgentSchema }),
  asyncHandler(sendRunToAgent),
)
runsRouter.get(
  '/:runId/artifacts/:artifactId',
  validate({ params: artifactParamSchema }),
  asyncHandler(getRunArtifact),
)
