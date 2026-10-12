import type { Request, Response } from 'express'
import { requireUser } from '../middleware/authenticate.js'
import {
  attachUploadToProject,
  createProjectForUser,
  deleteProjectForUser,
  getProjectForUser,
  getProjectStructure,
  listProjectsForUser,
  updateProjectForUser,
} from '../services/project.service.js'
import { badRequest } from '../utils/errors.js'
import type { ListProjectsQuery, CreateProjectInput, UpdateProjectInput } from '../validators/projects.validators.js'

export async function listProjects(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const query = req.query as unknown as ListProjectsQuery

  const result = await listProjectsForUser(user.sub, {
    page: query.page,
    limit: query.limit,
    ...(query.query ? { search: query.query } : {}),
  })

  res.json({
    items: result.items,
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / result.limit)),
  })
}

export async function createProject(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const body = req.body as CreateProjectInput

  const project = await createProjectForUser(user.sub, {
    name: body.name,
    ...(body.gitUrl ? { gitUrl: body.gitUrl } : {}),
    ...(body.branch ? { branch: body.branch } : {}),
  })
  res.status(201).json(project)
}

export async function getProject(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const project = await getProjectForUser(user.sub, req.params.id ?? '')
  res.json(project)
}

export async function updateProject(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const body = req.body as UpdateProjectInput
  const project = await updateProjectForUser(user.sub, req.params.id ?? '', {
    ...(body.name ? { name: body.name } : {}),
    ...(body.settings ? { settings: body.settings } : {}),
  })
  res.json(project)
}

export async function deleteProject(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  await deleteProjectForUser(user.sub, req.params.id ?? '')
  res.status(204).end()
}

export async function uploadProjectArchive(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  if (!req.file) {
    throw badRequest('Attach a zip archive in the "file" field.', 'FILE_REQUIRED')
  }

  const result = await attachUploadToProject(user.sub, req.params.id ?? '', {
    buffer: req.file.buffer,
    originalname: req.file.originalname,
  })
  res.json(result)
}

export async function getStructure(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const structure = await getProjectStructure(user.sub, req.params.id ?? '')
  res.json(structure)
}
