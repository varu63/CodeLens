import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Query } from '@tanstack/react-query'
import * as projectsApi from '../api/projects.api'
import { listProjectRuns } from '../api/runs.api'
import { getCommit, listProjectCommits } from '../api/commits.api'
import type {
  CommitsListParams,
  CreateProjectRequest,
  ProjectResponse,
  ProjectsListParams,
  RunsListParams,
  UpdateProjectRequest,
} from '../types/api.types'

export const projectKeys = {
  all: ['projects'] as const,
  list: (params: ProjectsListParams) => ['projects', 'list', params] as const,
  detail: (projectId: string) => ['projects', 'detail', projectId] as const,
  structure: (projectId: string) => ['projects', 'detail', projectId, 'structure'] as const,
  runs: (projectId: string, params: RunsListParams) => ['projects', 'detail', projectId, 'runs', params] as const,
  commits: (projectId: string, params: CommitsListParams) => ['projects', 'detail', projectId, 'commits', params] as const,
  commit: (projectId: string, sha: string) => ['projects', 'detail', projectId, 'commit', sha] as const,
}

export function useProjects(params: ProjectsListParams = {}) {
  return useQuery({
    queryKey: projectKeys.list(params),
    queryFn: () => projectsApi.listProjects(params),
    placeholderData: keepPreviousData,
  })
}

export function useProject(
  projectId: string | undefined,
  options: {
    refetchInterval?: number | false | ((query: Query<ProjectResponse>) => number | false | undefined)
  } = {},
) {
  return useQuery<ProjectResponse>({
    queryKey: projectKeys.detail(projectId ?? ''),
    queryFn: () => projectsApi.getProject(projectId as string),
    enabled: Boolean(projectId),
    ...options,
  })
}

export function useProjectStructure(projectId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.structure(projectId ?? ''),
    queryFn: () => projectsApi.getStructure(projectId as string),
    enabled: Boolean(projectId),
  })
}

export function useProjectRuns(projectId: string | undefined, params: RunsListParams = {}) {
  return useQuery({
    queryKey: projectKeys.runs(projectId ?? '', params),
    queryFn: () => listProjectRuns(projectId as string, params),
    enabled: Boolean(projectId),
    placeholderData: keepPreviousData,
  })
}

export function useProjectCommits(projectId: string | undefined, params: CommitsListParams = {}) {
  return useQuery({
    queryKey: projectKeys.commits(projectId ?? '', params),
    queryFn: () => listProjectCommits(projectId as string, params),
    enabled: Boolean(projectId),
    placeholderData: keepPreviousData,
  })
}

export function useCommit(projectId: string | undefined, sha: string | undefined) {
  return useQuery({
    queryKey: projectKeys.commit(projectId ?? '', sha ?? ''),
    queryFn: () => getCommit(projectId as string, sha as string),
    enabled: Boolean(projectId && sha),
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateProjectRequest) => projectsApi.createProject(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

export function useUploadProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, file, onProgress }: { projectId: string; file: File; onProgress?: (percent: number) => void }) =>
      projectsApi.uploadProject(projectId, file, onProgress),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all })
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) })
    },
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, body }: { projectId: string; body: UpdateProjectRequest }) =>
      projectsApi.updateProject(projectId, body),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all })
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(variables.projectId) })
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => projectsApi.deleteProject(projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}
