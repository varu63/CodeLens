import { Router } from 'express'
import multer from 'multer'
import {
  createProject,
  deleteProject,
  getProject,
  getStructure,
  listProjects,
  updateProject,
  uploadProjectArchive,
} from '../controllers/projects.controller.js'
import { listProjectRuns, startProjectRun } from '../controllers/runs.controller.js'
import { authenticate } from '../middleware/authenticate.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectIdParamSchema,
  updateProjectSchema,
} from '../validators/projects.validators.js'
import { listRunsQuerySchema, startRunSchema } from '../validators/runs.validators.js'

export const projectsRouter = Router()

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // 100 MB

const archiveUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
})

projectsRouter.use(authenticate)

projectsRouter.get('/', validate({ query: listProjectsQuerySchema }), asyncHandler(listProjects))
projectsRouter.post('/', validate({ body: createProjectSchema }), asyncHandler(createProject))
projectsRouter.get('/:id', validate({ params: projectIdParamSchema }), asyncHandler(getProject))
projectsRouter.patch(
  '/:id',
  validate({ params: projectIdParamSchema, body: updateProjectSchema }),
  asyncHandler(updateProject),
)
projectsRouter.delete('/:id', validate({ params: projectIdParamSchema }), asyncHandler(deleteProject))
projectsRouter.post(
  '/:id/upload',
  validate({ params: projectIdParamSchema }),
  archiveUpload.single('file'),
  asyncHandler(uploadProjectArchive),
)
projectsRouter.get(
  '/:id/structure',
  validate({ params: projectIdParamSchema }),
  asyncHandler(getStructure),
)

projectsRouter.post(
  '/:id/runs',
  validate({ params: projectIdParamSchema, body: startRunSchema }),
  asyncHandler(startProjectRun),
)
projectsRouter.get(
  '/:id/runs',
  validate({ params: projectIdParamSchema, query: listRunsQuerySchema }),
  asyncHandler(listProjectRuns),
)
