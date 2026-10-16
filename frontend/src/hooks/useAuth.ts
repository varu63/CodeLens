import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import * as authApi from '../api/auth.api'
import { clearSessionMarker, hasSessionMarker } from '../api/client'
import { useAuthStore } from '../store/authStore'
import type { LoginRequest, RegisterRequest } from '../types/api.types'

/** Runs at most once per page load: exchanges the cookie for a session. */
let bootstrapPromise: Promise<void> | null = null

export function bootstrapSession(): Promise<void> {
  bootstrapPromise ??= (async () => {
    const store = useAuthStore.getState()
    if (store.status === 'authenticated') return
    // No marker → the refresh cookie cannot be there either; skip the request
    // instead of hitting /auth/refresh (and the rate limiter) with no session.
    if (!hasSessionMarker()) {
      store.setStatus('unauthenticated')
      return
    }
    store.setStatus('initializing')
    try {
      const data = await authApi.refresh()
      const user = data.user ?? (await authApi.me())
      useAuthStore.getState().setAuth(user, data.accessToken)
    } catch (error) {
      if (import.meta.env.DEV) console.error('[auth] session bootstrap failed:', error)
      useAuthStore.getState().clear()
    }
  })()
  return bootstrapPromise
}

export function useAuth() {
  const user = useAuthStore((state) => state.user)
  const status = useAuthStore((state) => state.status)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const login = useMutation({
    mutationFn: (body: LoginRequest) => authApi.login(body),
    meta: { suppressGlobalError: true },
    onSuccess: (data) => {
      useAuthStore.getState().setAuth(data.user, data.accessToken)
    },
  })

  const register = useMutation({
    mutationFn: (body: RegisterRequest) => authApi.register(body),
    meta: { suppressGlobalError: true },
    onSuccess: (data) => {
      useAuthStore.getState().setAuth(data.user, data.accessToken)
    },
  })

  const logoutMutation = useMutation({
    mutationFn: () => authApi.logout(),
    meta: { suppressGlobalError: true },
    onSettled: () => {
      clearSessionMarker()
      useAuthStore.getState().clear()
      queryClient.clear()
      navigate('/login', { replace: true })
    },
  })

  return {
    user,
    status,
    isAuthenticated: status === 'authenticated' && user !== null,
    isAdmin: user?.role === 'admin',
    isLoading: status === 'idle' || status === 'initializing',
    login,
    register,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  }
}
