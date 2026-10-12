import { create } from 'zustand'
import type { User } from '../types/domain.types'

export type AuthStatus = 'idle' | 'initializing' | 'authenticated' | 'unauthenticated'

interface AuthState {
  /** The signed-in user, or null. */
  user: User | null
  /**
   * Access token — kept IN MEMORY ONLY (never localStorage / sessionStorage).
   * The refresh token lives in an httpOnly cookie handled by the backend.
   */
  accessToken: string | null
  status: AuthStatus
  setAuth: (user: User | null, accessToken: string) => void
  setUser: (user: User) => void
  clear: () => void
  setStatus: (status: AuthStatus) => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  accessToken: null,
  status: 'idle',
  setAuth: (user, accessToken) =>
    set((state) => ({
      user: user ?? state.user,
      accessToken,
      status: 'authenticated',
    })),
  setUser: (user) => set({ user }),
  clear: () => set({ user: null, accessToken: null, status: 'unauthenticated' }),
  setStatus: (status) => set({ status }),
}))

export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken
}

export function isAdminUser(user: User | null): boolean {
  return user?.role === 'admin'
}
