/**
 * Mock mode entry point.
 * VITE_USE_MOCKS=true swaps the axios adapter for an in-memory backend so the
 * whole UI works before the real API exists.
 */

import { AxiosError } from 'axios'
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { handleMockRequest } from './handlers'

export const USE_MOCKS: boolean = import.meta.env.VITE_USE_MOCKS === 'true'

export function isMockMode(): boolean {
  return USE_MOCKS
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export const mockAdapter: AxiosAdapter = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
  // Small, jittered latency so loading states are real.
  await sleep(120 + Math.random() * 200)
  const result = handleMockRequest(config)
  const response = {
    data: result.data,
    status: result.status,
    statusText: STATUS_TEXT[result.status] ?? 'OK',
    headers: {},
    config,
    request: { mock: true },
  } as unknown as AxiosResponse

  if (result.status >= 400) {
    throw new AxiosError(
      result.message ?? STATUS_TEXT[result.status] ?? 'Mock error',
      String(result.status),
      config,
      response.request,
      response,
    )
  }
  return response
}

export { subscribeMockRunStream, cancelMockRun } from './db'
export type { MockStreamHandle, MockStreamHandlers } from './db'
