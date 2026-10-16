import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export type AuthThemeMode = 'light' | 'dark' | 'system'
export type AuthResolvedTheme = 'light' | 'dark'

// Separate from the dashboard preference so the two never interfere.
const STORAGE_KEY = 'proofloop-auth-theme'

function isMode(value: unknown): value is AuthThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

function readStoredMode(): AuthThemeMode {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isMode(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

function getSystemTheme(): AuthResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolve(mode: AuthThemeMode, systemTheme: AuthResolvedTheme): AuthResolvedTheme {
  return mode === 'system' ? systemTheme : mode
}

interface AuthThemeContextValue {
  /** Stored preference: 'light' | 'dark' | 'system'. */
  mode: AuthThemeMode
  /** Actual theme in effect after resolving 'system'. */
  resolved: AuthResolvedTheme
  setMode: (mode: AuthThemeMode) => void
  /** Flip between light and dark (switches away from 'system'). */
  toggle: () => void
}

const AuthThemeContext = createContext<AuthThemeContextValue | null>(null)

/**
 * Auth-scoped theme provider.
 *
 * The resolved theme is exposed via `useAuthTheme` so the auth layout can put
 * it on its own `.auth-scope` wrapper (as `data-auth-theme`). It deliberately
 * never touches <html> or document.documentElement, so switching the auth
 * theme cannot restyle the rest of the application.
 */
export function AuthThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AuthThemeMode>(readStoredMode)
  const [systemTheme, setSystemTheme] = useState<AuthResolvedTheme>(getSystemTheme)

  // React to OS-level changes while the preference is 'system'.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setSystemTheme(query.matches ? 'dark' : 'light')
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const setMode = useCallback((next: AuthThemeMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // private mode — preference just won't persist
    }
    setModeState(next)
  }, [])

  const toggle = useCallback(() => {
    setMode(resolve(mode, getSystemTheme()) === 'dark' ? 'light' : 'dark')
  }, [mode, setMode])

  // Keep multiple tabs in sync.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setModeState(readStoredMode())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const resolved = resolve(mode, systemTheme)

  const value = useMemo<AuthThemeContextValue>(
    () => ({ mode, resolved, setMode, toggle }),
    [mode, resolved, setMode, toggle],
  )

  return <AuthThemeContext.Provider value={value}>{children}</AuthThemeContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthTheme(): AuthThemeContextValue {
  const context = useContext(AuthThemeContext)
  if (!context) {
    throw new Error('useAuthTheme must be used within an AuthThemeProvider')
  }
  return context
}
