import axios, { AxiosError } from 'axios'
import type { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '../store/authStore'
import { USE_MOCKS, mockAdapter } from '../mocks'
import type { RefreshResponse } from '../types/api.types'

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api/v1'

declare module 'axios' {
  export interface AxiosRequestConfig {
    /** Internal: the request already went through one refresh-and-retry cycle. */
    _retry?: boolean
    /** Set on auth endpoints so a 401 never triggers the refresh flow. */
    skipAuthRefresh?: boolean
    /** Set on login/register so no stale bearer token is attached. */
    skipAuth?: boolean
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: unknown
  readonly retryAfterSeconds?: number

  constructor(message: string, status: number, code?: string, details?: unknown, retryAfterSeconds?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function normalizeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  if (error instanceof AxiosError) {
    const response = error.response
    if (!response) {
      const message =
        error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT'
          ? 'The request timed out. Please try again.'
          : 'Cannot reach the server. Check your connection and try again.'
      return new ApiError(message, 0, error.code)
    }

    const status = response.status
    const body = response.data as
      | { message?: string; error?: string | { message?: string; code?: string }; code?: string; details?: unknown }
      | undefined
    const nested = typeof body?.error === 'object' && body.error !== null ? body.error : undefined
    const serverMessage =
      body?.message ?? nested?.message ?? (typeof body?.error === 'string' ? body.error : undefined)
    const retryAfterHeader = response.headers?.['retry-after']
    const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) || undefined : undefined

    const fallback: Record<number, string> = {
      400: 'The request was invalid.',
      401: 'Your session has expired.',
      403: "You don't have permission to do that.",
      404: 'The requested resource was not found.',
      409: 'This conflicts with existing data.',
      413: 'The upload is too large.',
      429: 'Too many requests.',
      500: 'Something went wrong on the server.',
      502: 'The server is temporarily unavailable.',
      503: 'The service is temporarily unavailable.',
    }

    return new ApiError(
      serverMessage ?? fallback[status] ?? `Request failed with status ${status}`,
      status,
      body?.code ?? nested?.code,
      body?.details,
      retryAfterSeconds,
    )
  }

  if (error instanceof Error) return new ApiError(error.message, 0)
  return new ApiError('Something went wrong', 0)
}

/** User-facing message for any thrown error. */
export function getErrorMessage(error: unknown): string {
  const apiError = normalizeError(error)
  if (apiError.status === 429) {
    return apiError.retryAfterSeconds
      ? `Too many requests. Try again in ${apiError.retryAfterSeconds}s.`
      : 'Too many requests. Please slow down and try again shortly.'
  }
  // For everything else trust the server message when there is one (e.g.
  // "Invalid email or password"); the fallbacks in normalizeError cover the rest.
  return apiError.message
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/* -------------------------------------------------------------------------- */
/* Session presence marker                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The refresh token is an httpOnly cookie, so JS cannot tell whether a session
 * exists. This non-secret localStorage flag (set on successful auth, cleared on
 * logout/session-expiry) lets the app skip /auth/refresh entirely — including
 * on the login page and before the first-ever login — instead of burning a
 * request (and the dev rate budget) on a guaranteed 401.
 */
const SESSION_MARKER_KEY = 'proofloop:has-session'

export function hasSessionMarker(): boolean {
  try {
    return window.localStorage.getItem(SESSION_MARKER_KEY) === '1'
  } catch {
    return false
  }
}

export function setSessionMarker(): void {
  try {
    window.localStorage.setItem(SESSION_MARKER_KEY, '1')
  } catch {
    // storage unavailable (private mode etc.) — refresh still works, just uncached
  }
}

export function clearSessionMarker(): void {
  try {
    window.localStorage.removeItem(SESSION_MARKER_KEY)
  } catch {
    // storage unavailable — nothing to clear
  }
}

function logErrorInDev(...args: unknown[]): void {
  if (import.meta.env.DEV) console.error(...args)
}

/* -------------------------------------------------------------------------- */
/* Single-flight token refresh                                                */
/* -------------------------------------------------------------------------- */

let refreshPromise: Promise<string> | null = null

async function performRefresh(): Promise<string> {
  const { data } = await client.post<RefreshResponse>('/auth/refresh', null, {
    skipAuth: true,
    skipAuthRefresh: true,
  })
  useAuthStore.getState().setAuth(data.user ?? null, data.accessToken)
  setSessionMarker()
  return data.accessToken
}

/**
 * Refreshes the access token at most once for any number of concurrent 401s:
 * everyone who asks while a refresh is in flight shares the same promise.
 */
export function refreshOnce(): Promise<string> {
  refreshPromise ??= performRefresh().finally(() => {
    refreshPromise = null
  })
  return refreshPromise
}

function handleSessionExpired(): void {
  const { accessToken, user } = useAuthStore.getState()
  if (!accessToken && !user) return
  useAuthStore.getState().clear()
  clearSessionMarker()
  const path = window.location.pathname
  if (path !== '/login' && path !== '/auth/callback') {
    window.location.assign('/login?expired=1')
  }
}

/* -------------------------------------------------------------------------- */
/* Client                                                                     */
/* -------------------------------------------------------------------------- */

export const client: AxiosInstance = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 45_000,
  headers: { Accept: 'application/json' },
  ...(USE_MOCKS ? { adapter: mockAdapter } : {}),
})

client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { accessToken } = useAuthStore.getState()
  if (accessToken && !config.skipAuth) {
    config.headers.Authorization = `Bearer ${accessToken}`
  }
  return config
})

client.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    logErrorInDev('[api] request failed:', error)

    const axiosError = error instanceof AxiosError ? error : null
    const original = axiosError?.config as AxiosRequestConfig | undefined
    const status = axiosError?.response?.status

    if (status === 401 && original && !original._retry && !original.skipAuthRefresh) {
      original._retry = true
      try {
        const token = await refreshOnce()
        original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${token}` }
        return await client.request(original)
      } catch (refreshError) {
        logErrorInDev('[api] token refresh failed:', refreshError)
        handleSessionExpired()
        throw normalizeError(refreshError instanceof AxiosError && refreshError.response ? error : refreshError)
      }
    }

    throw normalizeError(error)
  },
)
