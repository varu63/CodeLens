import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as findingsApi from '../api/findings.api'
import * as runsApi from '../api/runs.api'
import type { FeedbackRequest, FeedbackResponse, FindingResponse, SendToAgentRequest } from '../types/api.types'

export const findingKeys = {
  detail: (findingId: string) => ['findings', 'detail', findingId] as const,
}

export function useFinding(findingId: string | undefined) {
  return useQuery({
    queryKey: findingKeys.detail(findingId ?? ''),
    queryFn: () => findingsApi.getFinding(findingId as string),
    enabled: Boolean(findingId),
  })
}

export function useSubmitFeedback(findingId: string) {
  const queryClient = useQueryClient()
  return useMutation<FeedbackResponse, Error, FeedbackRequest>({
    mutationFn: (body) => findingsApi.sendFeedback(findingId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: findingKeys.detail(findingId) })
    },
  })
}

export function useRunFindingsForAgent(runId: string | undefined) {
  return useQuery({
    queryKey: ['runs', runId ?? '', 'findings', { forAgent: true }],
    queryFn: () => runsApi.listRunFindings(runId as string, { page: 1, limit: 100 }),
    enabled: Boolean(runId),
  })
}

export function useSendToAgent(runId: string) {
  return useMutation<Awaited<ReturnType<typeof runsApi.sendToAgent>>, Error, SendToAgentRequest>({
    mutationFn: (body) => runsApi.sendToAgent(runId, body),
  })
}

export type { FindingResponse }
