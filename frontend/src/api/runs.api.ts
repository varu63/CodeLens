import { client, isApiError } from './client'
import { refreshOnce } from './client'
import { API_URL } from './client'
import { getAccessToken } from '../store/authStore'
import { isMockMode, subscribeMockRunStream } from '../mocks'
import type {
  ArtifactResponse,
  CancelRunResponse,
  ChecksListParams,
  ChecksListResponse,
  FindingsListParams,
  FindingsListResponse,
  LoadTestResponse,
  ReportFormat,
  RerunResponse,
  RunResponse,
  RunStreamEvent,
  RunsListParams,
  RunsListResponse,
  SendToAgentRequest,
  SendToAgentResponse,
  StartRunRequest,
  StartRunResponse,
} from '../types/api.types'

const MAX_STREAM_ATTEMPTS = 5

/** Starts a verification run. Returns 202 + runId; stream/navigate from there. */
export async function startRun(projectId: string, body: StartRunRequest = {}): Promise<StartRunResponse> {
  const { data } = await client.post<StartRunResponse>(
    `/projects/${encodeURIComponent(projectId)}/runs`,
    body,
  )
  return data
}

export async function listProjectRuns(projectId: string, params: RunsListParams = {}): Promise<RunsListResponse> {
  const { data } = await client.get<RunsListResponse>(`/projects/${encodeURIComponent(projectId)}/runs`, {
    params,
  })
  return data
}

export async function getRun(runId: string): Promise<RunResponse> {
  const { data } = await client.get<RunResponse>(`/runs/${encodeURIComponent(runId)}`)
  return data
}

export async function listRunChecks(runId: string, params: ChecksListParams = {}): Promise<ChecksListResponse> {
  const { data } = await client.get<ChecksListResponse>(`/runs/${encodeURIComponent(runId)}/checks`, {
    params,
  })
  return data
}

export async function getLoadTest(runId: string): Promise<LoadTestResponse> {
  const { data } = await client.get<LoadTestResponse>(`/runs/${encodeURIComponent(runId)}/load-test`)
  return data
}

export async function listRunFindings(runId: string, params: FindingsListParams = {}): Promise<FindingsListResponse> {
  const { data } = await client.get<FindingsListResponse>(`/runs/${encodeURIComponent(runId)}/findings`, {
    params,
  })
  return data
}

export async function cancelRun(runId: string): Promise<CancelRunResponse> {
  const { data } = await client.post<CancelRunResponse>(`/runs/${encodeURIComponent(runId)}/cancel`)
  return data
}

export async function rerunRun(runId: string, body: StartRunRequest = {}): Promise<RerunResponse> {
  const { data } = await client.post<RerunResponse>(`/runs/${encodeURIComponent(runId)}/rerun`, body)
  return data
}

export async function sendToAgent(runId: string, body: SendToAgentRequest): Promise<SendToAgentResponse> {
  const { data } = await client.post<SendToAgentResponse>(
    `/runs/${encodeURIComponent(runId)}/send-to-agent`,
    body,
  )
  return data
}

export async function getArtifact(runId: string, artifactId: string): Promise<ArtifactResponse> {
  const { data } = await client.get<ArtifactResponse>(
    `/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`,
  )
  return data
}

export async function downloadReport(runId: string, format: ReportFormat): Promise<Blob> {
  const { data } = await client.get<Blob>(`/runs/${encodeURIComponent(runId)}/report`, {
    params: { format },
    responseType: 'blob',
  })
  return data
}

/* -------------------------------------------------------------------------- */
/* Live run stream (Server-Sent Events over fetch)                            */
/* -------------------------------------------------------------------------- */

export interface RunStreamHandlers {
  onOpen?: () => void
  onEvent: (event: RunStreamEvent) => void
  onError?: (error: Error) => void
  /** finished = true when a terminal `done` event was received. */
  onClose: (finished: boolean) => void
}

export interface RunStreamHandle {
  close: () => void
}

const STREAM_EVENT_TYPES = ['status', 'stage', 'progress', 'check', 'finding', 'load', 'done'] as const

function parseFrame(frame: string): RunStreamEvent | null {
  let eventName = 'message'
  const dataLines: string[] = []
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line || line.startsWith(':')) continue
    if (line.startsWith('event:')) eventName = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
  }
  if (!dataLines.length || eventName === 'ping') return null
  if (!(STREAM_EVENT_TYPES as readonly string[]).includes(eventName)) return null
  try {
    const payload = JSON.parse(dataLines.join('\n')) as RunStreamEvent['data']
    return { type: eventName, data: payload } as RunStreamEvent
  } catch {
    return null
  }
}

function streamUrl(runId: string): string {
  return `${API_URL.replace(/\/$/, '')}/runs/${encodeURIComponent(runId)}/stream`
}

function backoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000)
}

/**
 * Subscribes to the live run stream. Native EventSource cannot send an
 * Authorization header, so this uses fetch + a streaming body reader.
 * Reconnects with exponential backoff; onClose(false) signals the caller to
 * fall back to polling.
 */
export function openRunStream(
  runId: string,
  handlers: RunStreamHandlers,
  signal?: AbortSignal,
): RunStreamHandle {
  if (isMockMode()) {
    return subscribeMockRunStream(runId, handlers)
  }

  const controller = new AbortController()
  let closed = false
  let finished = false
  let attempts = 0

  const onExternalAbort = () => {
    closed = true
    controller.abort()
  }
  signal?.addEventListener('abort', onExternalAbort)

  const cleanup = () => {
    signal?.removeEventListener('abort', onExternalAbort)
  }

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, ms)
      controller.signal.addEventListener('abort', () => {
        window.clearTimeout(timer)
        resolve()
      }, { once: true })
    })

  async function connect(): Promise<void> {
    while (!closed && !finished) {
      try {
        let token = getAccessToken()
        let response = await fetch(streamUrl(runId), {
          headers: {
            Accept: 'text/event-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: 'include',
          signal: controller.signal,
        })

        if (response.status === 401) {
          try {
            token = await refreshOnce()
            response = await fetch(streamUrl(runId), {
              headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
              credentials: 'include',
              signal: controller.signal,
            })
          } catch {
            throw new Error('Session expired while connecting to the live stream')
          }
        }

        if (!response.ok || !response.body) {
          throw new Error(`Live stream failed with status ${response.status}`)
        }

        attempts = 0
        handlers.onOpen?.()

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (!closed && !finished) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let separator = buffer.indexOf('\n\n')
          while (separator !== -1) {
            const frame = buffer.slice(0, separator)
            buffer = buffer.slice(separator + 2)
            separator = buffer.indexOf('\n\n')
            const event = parseFrame(frame)
            if (event) {
              handlers.onEvent(event)
              if (event.type === 'done') {
                finished = true
                void reader.cancel().catch(() => undefined)
                break
              }
            }
          }
        }

        if (finished || closed) break
        throw new Error('Live stream ended unexpectedly')
      } catch (error) {
        if (closed || finished || signal?.aborted) break
        attempts += 1
        const err = error instanceof Error ? error : new Error('Live stream error')
        if (attempts >= MAX_STREAM_ATTEMPTS) {
          handlers.onError?.(err)
          break
        }
        handlers.onError?.(err)
        await sleep(backoffDelay(attempts))
      }
    }

    cleanup()
    if (!signal?.aborted) handlers.onClose(finished)
  }

  void connect()

  return {
    close: () => {
      closed = true
      controller.abort()
      cleanup()
    },
  }
}

/** True when the error means "retry later" rather than "give up". */
export function isRetryableStreamError(error: unknown): boolean {
  if (isApiError(error)) return error.status === 0 || error.status >= 500
  return true
}
