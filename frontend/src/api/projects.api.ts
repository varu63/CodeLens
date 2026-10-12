import { client } from './client'
import type {
  CreateProjectRequest,
  ProjectResponse,
  ProjectsListParams,
  ProjectsListResponse,
  StructureResponse,
  UpdateProjectRequest,
  UploadProjectResponse,
} from '../types/api.types'

export async function listProjects(params: ProjectsListParams = {}): Promise<ProjectsListResponse> {
  const { data } = await client.get<ProjectsListResponse>('/projects', { params })
  return data
}

export async function getProject(projectId: string): Promise<ProjectResponse> {
  const { data } = await client.get<ProjectResponse>(`/projects/${encodeURIComponent(projectId)}`)
  return data
}

export async function createProject(body: CreateProjectRequest): Promise<ProjectResponse> {
  const { data } = await client.post<ProjectResponse>('/projects', body)
  return data
}

export async function uploadProject(
  projectId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadProjectResponse> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await client.post<UploadProjectResponse>(
    `/projects/${encodeURIComponent(projectId)}/upload`,
    form,
    {
      timeout: 10 * 60 * 1000,
      onUploadProgress: (event) => {
        if (onProgress && event.total) {
          onProgress(Math.round((event.loaded / event.total) * 100))
        }
      },
    },
  )
  return data
}

export async function updateProject(
  projectId: string,
  body: UpdateProjectRequest,
): Promise<ProjectResponse> {
  const { data } = await client.patch<ProjectResponse>(`/projects/${encodeURIComponent(projectId)}`, body)
  return data
}

export async function deleteProject(projectId: string): Promise<void> {
  await client.delete(`/projects/${encodeURIComponent(projectId)}`)
}

export async function getStructure(projectId: string): Promise<StructureResponse> {
  const { data } = await client.get<StructureResponse>(
    `/projects/${encodeURIComponent(projectId)}/structure`,
  )
  return data
}
