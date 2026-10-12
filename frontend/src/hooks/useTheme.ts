import { useEffect } from 'react'
import { create } from 'zustand'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'proofloop-theme'

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  try {
    return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.remove('dark', 'light')
  document.documentElement.classList.add(theme)
  document.documentElement.style.colorScheme = theme
}

/**
 * Shared theme store. Several components (Navbar, Settings) render theme UI,
 * so the choice must live outside any single component — otherwise labels go
 * stale the moment another component changes it.
 */
const useThemeStore = create<{
  theme: Theme
  setTheme: (theme: Theme) => void
  toggle: () => void
}>((set, get) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    applyTheme(theme)
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // private mode — theme just won't persist
    }
    set({ theme })
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}))

export function useTheme() {
  const theme = useThemeStore((state) => state.theme)

  // Keep every tab in sync when another one changes the preference.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) useThemeStore.getState().setTheme(readStoredTheme())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return {
    theme,
    setTheme: useThemeStore.getState().setTheme,
    toggle: useThemeStore.getState().toggle,
  }
}
