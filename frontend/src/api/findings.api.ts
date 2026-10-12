import { client } from './client'
import type {
  FeedbackRequest,
  FeedbackResponse,
  FindingResponse,
  FindingsListParams,
  FindingsListResponse,
} from '../types/api.types'

export async function getFinding(findingId: string): Promise<FindingResponse> {
  const { data } = await client.get<FindingResponse>(`/findings/${encodeURIComponent(findingId)}`)
  return data
}

export async function listFindings(params: FindingsListParams = {}): Promise<FindingsListResponse> {
  const { data } = await client.get<FindingsListResponse>('/findings', { params })
  return data
}

export async function sendFeedback(
  findingId: string,
  body: FeedbackRequest,
): Promise<FeedbackResponse> {
  const { data } = await client.post<FeedbackResponse>(
    `/findings/${encodeURIComponent(findingId)}/feedback`,
    body,
  )
  return data
}
