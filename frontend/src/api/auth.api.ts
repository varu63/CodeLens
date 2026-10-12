import { API_URL, client } from './client'
import type {
  AuthResponse,
  LoginRequest,
  MeResponse,
  RefreshResponse,
  RegisterRequest,
} from '../types/api.types'

/**
 * Endpoint for the Google OAuth Authorization Code flow.
 * The backend owns the client secret; we only navigate the browser there.
 */
export function googleAuthUrl(): string {
  return `${API_URL.replace(/\/$/, '')}/auth/google`
}

/** Exchanges the httpOnly refresh cookie for a fresh access token. */
export async function refresh(): Promise<RefreshResponse> {
  const { data } = await client.post<RefreshResponse>('/auth/refresh', null, {
    skipAuth: true,
    skipAuthRefresh: true,
  })
  return data
}

export async function me(): Promise<MeResponse> {
  const { data } = await client.get<MeResponse>('/auth/me')
  return data
}

export async function login(body: LoginRequest): Promise<AuthResponse> {
  const { data } = await client.post<AuthResponse>('/auth/login', body, {
    skipAuth: true,
    skipAuthRefresh: true,
  })
  return data
}

export async function register(body: RegisterRequest): Promise<AuthResponse> {
  const { data } = await client.post<AuthResponse>('/auth/register', body, {
    skipAuth: true,
    skipAuthRefresh: true,
  })
  return data
}

export async function logout(): Promise<void> {
  await client.post('/auth/logout', null, { skipAuthRefresh: true })
}
