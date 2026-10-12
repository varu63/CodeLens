import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { openRunStream } from '../api/runs.api'
import * as runsApi from '../api/runs.api'
import { projectKeys } from './useProjects'
import { RUN_STAGE_ORDER } from '../types/domain.types'
import type { Check, Finding, Run, RunStageProgress } from '../types/domain.types'
import type {
  ChecksListParams,
  ChecksListResponse,
  FindingsListParams,
  FindingsListResponse,
  LoadTestResponse,
  RunResponse,
  RunStreamEvent,
} from '../types/api.types'

export const runKeys = {
  detail: (runId: string) => ['runs', runId] as const,
  checks: (runId: string, params: ChecksListParams) => ['runs', runId, 'checks', params] as const,
  loadTest: (runId: string) => ['runs', runId, 'load-test'] as const,
  findings: (runId: string, params: FindingsListParams) => ['runs', runId, 'findings', params] as const,
}

export function useRun(runId: string | undefined, options: { refetchInterval?: number | false } = {}) {
  return useQuery<RunResponse>({
    queryKey: runKeys.detail(runId ?? ''),
    queryFn: () => runsApi.getRun(runId as string),
    enabled: Boolean(runId),
    refetchInterval: options.refetchInterval ?? false,
  })
}

export function useRunChecks(runId: string | undefined, params: ChecksListParams = {}) {
  return useQuery<ChecksListResponse>({
    queryKey: runKeys.checks(runId ?? '', params),
    queryFn: () => runsApi.listRunChecks(runId as string, params),
    enabled: Boolean(runId),
  })
}

export function useRunFindings(runId: string | undefined, params: FindingsListParams = {}) {
  return useQuery<FindingsListResponse>({
    queryKey: runKeys.findings(runId ?? '', params),
    queryFn: () => runsApi.listRunFindings(runId as string, params),
    enabled: Boolean(runId),
  })
}

export function useRunLoadTest(runId: string | undefined, enabled = true) {
  return useQuery<LoadTestResponse>({
    queryKey: runKeys.loadTest(runId ?? ''),
    queryFn: () => runsApi.getLoadTest(runId as string),
    enabled: Boolean(runId) && enabled,
  })
}

/* -------------------------------------------------------------------------- */
/* Live stream                                                                */
/* -------------------------------------------------------------------------- */

export type RunStreamMode = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'polling' | 'done'

export interface UseRunStreamResult {
  mode: RunStreamMode
  liveChecks: Check[]
  liveFindings: Finding[]
  stageOverrides: RunStageProgress[]
  lastEventAt: number | null
}

export function mergeStages(base: RunStageProgress[], updates: RunStageProgress[]): RunStageProgress[] {
  if (updates.length === 0) return base
  const map = new Map(base.map((stage) => [stage.stage, stage]))
  for (const update of updates) map.set(update.stage, update)
  return RUN_STAGE_ORDER.map((stageKey) => map.get(stageKey)).filter(
    (stage): stage is RunStageProgress => Boolean(stage),
  )
}

export function mergeById<T extends { id: string }>(base: T[], extra: T[]): T[] {
  if (extra.length === 0) return base
  const extraIds = new Set(extra.map((item) => item.id))
  return [...base.filter((item) => !extraIds.has(item.id)), ...extra]
}

interface StreamContext {
  queryClient: QueryClient
  runId: string
  setLiveChecks: React.Dispatch<React.SetStateAction<Check[]>>
  setLiveFindings: React.Dispatch<React.SetStateAction<Finding[]>>
  setStageOverrides: React.Dispatch<React.SetStateAction<RunStageProgress[]>>
}

function applyRunStreamEvent(event: RunStreamEvent, context: StreamContext): void {
  const { queryClient, runId } = context
  switch (event.type) {
    case 'status':
      queryClient.setQueryData<Run>(runKeys.detail(runId), (run) =>
        run ? { ...run, status: event.data.status, healthScore: event.data.healthScore ?? run.healthScore } : run,
      )
      break
    case 'stage':
      context.setStageOverrides((previous) => mergeStages(previous, [event.data]))
      break
    case 'check':
      context.setLiveChecks((previous) => mergeById(previous, [event.data]))
      break
    case 'finding':
      context.setLiveFindings((previous) => mergeById(previous, [event.data]))
      break
    case 'load':
      queryClient.setQueryData<LoadTestResponse>(runKeys.loadTest(runId), event.data)
      break
    case 'done':
      queryClient.setQueryData<Run>(runKeys.detail(runId), event.data)
      break
    case 'progress':
      break
  }
}

/**
 * Subscribes to the run's SSE stream (fetch-based so the Authorization header
 * is sent). Reconnects on drops; falls back to polling via `mode === 'polling'`
 * when the stream cannot be re-established.
 */
export function useRunStream(runId: string | undefined, enabled: boolean): UseRunStreamResult {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<RunStreamMode>(enabled ? 'connecting' : 'idle')
  const [liveChecks, setLiveChecks] = useState<Check[]>([])
  const [liveFindings, setLiveFindings] = useState<Finding[]>([])
  const [stageOverrides, setStageOverrides] = useState<RunStageProgress[]>([])
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const streamedRef = useRef(false)

  useEffect(() => {
    streamedRef.current = false
  }, [runId])

  useEffect(() => {
    if (!runId || !enabled) {
      setMode('idle')
      if (!runId || !streamedRef.current) return
      streamedRef.current = false
      // The run left the live state: refetch the canonical queries and then
      // drop the streamed snapshots. SSE frames carry creation-time cluster
      // metadata (clusterId/clusterSize) that goes stale as more findings land,
      // so it must not outlive the run.
      let cancelled = false
      void queryClient.invalidateQueries({ queryKey: ['runs', runId] }).then(() => {
        if (cancelled) return
        setLiveChecks([])
        setLiveFindings([])
        setStageOverrides([])
      })
      return () => {
        cancelled = true
      }
    }

    streamedRef.current = true
    setMode('connecting')
    setLiveChecks([])
    setLiveFindings([])
    setStageOverrides([])

    const controller = new AbortController()
    const handle = openRunStream(
      runId,
      {
        onOpen: () => setMode('live'),
        onEvent: (event) => {
          setLastEventAt(Date.now())
          applyRunStreamEvent(event, { queryClient, runId, setLiveChecks, setLiveFindings, setStageOverrides })
        },
        onError: () => setMode((current) => (current === 'polling' ? current : 'reconnecting')),
        onClose: (finished) => {
          setMode(finished ? 'done' : 'polling')
          void queryClient.invalidateQueries({ queryKey: ['runs', runId] })
          void queryClient.invalidateQueries({ queryKey: projectKeys.all })
        },
      },
      controller.signal,
    )

    return () => {
      controller.abort()
      handle.close()
    }
  }, [runId, enabled, queryClient])

  return { mode, liveChecks, liveFindings, stageOverrides, lastEventAt }
}
