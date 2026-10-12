import { client } from './client'
import type {
  CommitResponse,
  CommitsListParams,
  CommitsListResponse,
} from '../types/api.types'

export async function listProjectCommits(
  projectId: string,
  params: CommitsListParams = {},
): Promise<CommitsListResponse> {
  const { data } = await client.get<CommitsListResponse>(
    `/projects/${encodeURIComponent(projectId)}/commits`,
    { params },
  )
  return data
}

export async function getCommit(projectId: string, sha: string): Promise<CommitResponse> {
  const { data } = await client.get<CommitResponse>(
    `/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(sha)}`,
  )
  return data
}
