import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as runsApi from '../api/runs.api'
import { projectKeys } from './useProjects'
import { runKeys } from './useRunStream'
import type {
  ArtifactResponse,
  CancelRunResponse,
  RerunResponse,
  StartRunRequest,
  StartRunResponse,
} from '../types/api.types'

export function useStartRun(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation<StartRunResponse, Error, StartRunRequest>({
    mutationFn: (body) => runsApi.startRun(projectId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

export function useRerunRun(runId: string) {
  const queryClient = useQueryClient()
  return useMutation<RerunResponse, Error, StartRunRequest>({
    mutationFn: (body) => runsApi.rerunRun(runId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: runKeys.detail(runId) })
      void queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

export function useCancelRun(runId: string) {
  const queryClient = useQueryClient()
  return useMutation<CancelRunResponse, Error, void>({
    mutationFn: () => runsApi.cancelRun(runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['runs', runId] })
      void queryClient.invalidateQueries({ queryKey: projectKeys.all })
    },
  })
}

export function useDownloadReport(runId: string) {
  return useMutation({
    mutationFn: (format: 'json' | 'pdf') => runsApi.downloadReport(runId, format),
  })
}

/** Fetches an artifact (with signed URL + inline content) only when opened. */
export function useRunArtifact(runId: string | undefined, artifactId: string | null) {
  return useQuery<ArtifactResponse>({
    queryKey: [...runKeys.detail(runId ?? ''), 'artifact', artifactId ?? ''],
    queryFn: () => runsApi.getArtifact(runId as string, artifactId as string),
    enabled: Boolean(runId && artifactId),
    staleTime: 60_000,
  })
}
