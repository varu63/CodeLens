import { deletePrefix, putObjectBuffer } from '../config/storage.js'
import {
  createProject,
  deleteProjectRow,
  findProjectById,
  listProjects,
  updateProjectRow,
  updateProjectSettings,
} from '../db/queries/projects.queries.js'
import type { ProjectRow, ProjectSettingsRow } from '../db/queries/projects.queries.js'
import { findLatestRunForProject, latestRunsForProjects } from '../db/queries/runs.queries.js'
import { EMPTY_STRUCTURE, findStructure, structureCountsForProjects, upsertStructure } from '../db/queries/structures.queries.js'
import type { StructureMapData } from '../db/queries/structures.queries.js'
import { badRequest, notFound } from '../utils/errors.js'
import { logger } from '../utils/logger.js'
import { assertOwned } from '../utils/ownership.js'
import { toApiProject } from '../utils/mappers.js'
import type { ApiProject } from '../utils/mappers.js'
import { scanWorkspace } from './scan.service.js'
import { cloneRepository, extractZipArchive, removeWorkspace, workspaceDir } from './workspace.service.js'

/** In-process guard so one project never runs two scans at once. */
const scanning = new Set<string>()

export interface CreateProjectInput {
  name: string
  gitUrl?: string
  branch?: string
}

export async function createProjectForUser(userId: string, input: CreateProjectInput): Promise<ApiProject> {
  const isGit = Boolean(input.gitUrl)
  const row = await createProject({
    userId,
    name: input.name,
    source: isGit ? 'git' : 'upload',
    repoUrl: input.gitUrl ?? null,
    ...(input.branch ? { branch: input.branch } : {}),
  })

  if (isGit && input.gitUrl) {
    const gitUrl = input.gitUrl
    const branch = input.branch
    kickOffScan(row.id, async () => {
      await cloneRepository(row.id, gitUrl, branch)
      await updateProjectRow(row.id, { storagePath: workspaceDir(row.id) })
    })
  }

  return toApiProject(row)
}

export interface UploadResult {
  project: ApiProject
  filesDetected: number
  bytesUploaded: number
}

export async function attachUploadToProject(
  userId: string,
  projectId: string,
  file: { buffer: Buffer; originalname: string },
): Promise<UploadResult> {
  const row = await getOwnedProject(userId, projectId)
  if (row.source !== 'upload') {
    throw badRequest('This project was created from a git repository.', 'NOT_UPLOAD_PROJECT')
  }

  const { filesDetected, bytesExtracted } = await extractZipArchive(projectId, file.buffer)

  const s3Key = `projects/${projectId}/source.zip`
  try {
    await putObjectBuffer(s3Key, file.buffer, 'application/zip')
  } catch (error) {
    logger.warn({ err: error, projectId }, 'Could not archive uploaded zip to object storage')
  }
  await updateProjectRow(projectId, { storagePath: s3Key })

  kickOffScan(projectId)

  const updated = await getOwnedProject(userId, projectId)
  return {
    project: toApiProject(updated),
    filesDetected,
    bytesUploaded: bytesExtracted,
  }
}

/**
 * Runs a scan in the background: status becomes scanning → ready | error.
 * Failures never bubble to the HTTP layer.
 */
function kickOffScan(projectId: string, prepare?: () => Promise<void>): void {
  if (scanning.has(projectId)) return
  scanning.add(projectId)

  void (async () => {
    try {
      await updateProjectRow(projectId, { status: 'scanning' })
      if (prepare) await prepare()

      const dir = workspaceDir(projectId)
      const { structure, stack } = await scanWorkspace(dir)

      await upsertStructure(projectId, structure)
      await updateProjectRow(projectId, {
        status: 'ready',
        detectedStack: stack as unknown as Record<string, unknown>,
      })
      logger.info({ projectId, routes: structure.routes.length }, 'Project scan finished')
    } catch (error) {
      logger.error({ err: error, projectId }, 'Project scan failed')
      try {
        await updateProjectRow(projectId, { status: 'error' })
      } catch {
        // project deleted mid-scan — nothing to update
      }
    } finally {
      scanning.delete(projectId)
    }
  })()
}

export async function getOwnedProject(userId: string, projectId: string): Promise<ProjectRow> {
  const row = await findProjectById(projectId)
  if (!row) throw notFound('Project not found')
  return assertOwned(row, userId, 'Project')
}

export interface ListProjectsResult {
  items: ApiProject[]
  total: number
  page: number
  limit: number
}

export async function listProjectsForUser(
  userId: string,
  params: { page: number; limit: number; search?: string },
): Promise<ListProjectsResult> {
  const { rows, total } = await listProjects({
    userId,
    page: params.page,
    limit: params.limit,
    ...(params.search ? { search: params.search } : {}),
  })

  const ids = rows.map((row) => row.id)
  const [counts, latestRuns] = await Promise.all([
    structureCountsForProjects(ids),
    latestRunsForProjects(ids),
  ])

  return {
    items: rows.map((row) =>
      toApiProject(row, counts.get(row.id), latestRuns.get(row.id) ?? null),
    ),
    total,
    page: params.page,
    limit: params.limit,
  }
}

export async function getProjectForUser(userId: string, projectId: string): Promise<ApiProject> {
  const row = await getOwnedProject(userId, projectId)
  const [counts, latestRun] = await Promise.all([
    structureCountsForProjects([row.id]).then((map) => map.get(row.id)),
    findLatestRunForProject(row.id),
  ])
  return toApiProject(row, counts, latestRun)
}

export async function getProjectStructure(userId: string, projectId: string): Promise<StructureMapData> {
  await getOwnedProject(userId, projectId)
  const stored = await findStructure(projectId)
  return stored?.data ?? EMPTY_STRUCTURE
}

export async function updateProjectForUser(
  userId: string,
  projectId: string,
  changes: {
    name?: string
    settings?: {
      defaultLoadUsers?: number
      errorRateThresholdPct?: number
      p95ThresholdMs?: number
    }
  },
): Promise<ApiProject> {
  await getOwnedProject(userId, projectId)

  if (changes.name) {
    await updateProjectRow(projectId, { name: changes.name })
  }

  if (changes.settings) {
    const merged: ProjectSettingsRow = {}
    if (changes.settings.defaultLoadUsers !== undefined) {
      merged.loadUsers = changes.settings.defaultLoadUsers
    }
    const thresholds: ProjectSettingsRow['thresholds'] = {}
    if (changes.settings.errorRateThresholdPct !== undefined) {
      thresholds.errorRatePct = changes.settings.errorRateThresholdPct
    }
    if (changes.settings.p95ThresholdMs !== undefined) {
      thresholds.p95Ms = changes.settings.p95ThresholdMs
    }
    if (Object.keys(thresholds).length > 0) merged.thresholds = thresholds
    if (Object.keys(merged).length > 0) await updateProjectSettings(projectId, merged)
  }

  return getProjectForUser(userId, projectId)
}

export async function deleteProjectForUser(userId: string, projectId: string): Promise<void> {
  await getOwnedProject(userId, projectId)

  await deleteProjectRow(projectId)
  await Promise.all([
    removeWorkspace(projectId).catch((error: unknown) => {
      logger.warn({ err: error, projectId }, 'Could not remove local workspace')
    }),
    deletePrefix(`projects/${projectId}/`).catch((error: unknown) => {
      logger.warn({ err: error, projectId }, 'Could not remove stored sources')
    }),
  ])
}
