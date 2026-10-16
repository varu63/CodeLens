import { Monitor, Moon, Sun } from 'lucide-react'
import { useAuthTheme } from '../../theme/ThemeProvider'
import type { AuthThemeMode } from '../../theme/ThemeProvider'
import { cn } from '../../utils/format'

const OPTIONS: ReadonlyArray<{
  value: AuthThemeMode
  label: string
  Icon: typeof Sun
}> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

export function ThemeToggle({ className }: { className?: string }) {
  const { mode, setMode } = useAuthTheme()

  return (
    <div role="group" aria-label="Color theme" className={cn('auth-toggle', className)}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mode === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            aria-label={`${label} theme`}
            aria-pressed={active}
            title={`${label} theme`}
            className={cn('auth-toggle__btn', active && 'is-active')}
          >
            <Icon size={14} aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
