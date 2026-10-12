import { Link, useNavigate } from 'react-router-dom'
import {
  CircleUserRound,
  FolderGit2,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../hooks/useTheme'
import { useProjects } from '../hooks/useProjects'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { cn, formatDate } from '../utils/format'

const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
] as const

export function SettingsPage() {
  const { user, logout, isLoggingOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()
  const projectsQuery = useProjects({ page: 1, limit: 1 })

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : '?'

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-fg">Settings</h1>
        <p className="mt-1 text-sm text-muted">Your profile, appearance and verification preferences.</p>
      </header>

      {/* Profile */}
      <section className="card card-pad">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <CircleUserRound size={15} className="text-faint" aria-hidden="true" />
          Profile
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-accent/15 text-lg font-semibold text-accent">
            {initials}
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-medium text-fg">
              {user?.name}
              <Badge variant={user?.role === 'admin' ? 'accent' : 'default'}>
                {user?.role === 'admin' ? 'Admin' : 'Member'}
              </Badge>
            </p>
            <p className="truncate text-sm text-muted">{user?.email}</p>
            <p className="mt-1 text-xs text-faint">
              Account {user?.id} · joined {formatDate(user?.createdAt)}
            </p>
          </div>
        </div>
        <p className="mt-4 rounded-lg border bg-sunken px-3.5 py-2.5 text-xs leading-relaxed text-muted">
          Profile details come from your identity provider (Google or email sign-up). ProofLoop never
          stores your provider password.
        </p>
      </section>

      {/* Appearance */}
      <section className="card card-pad">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Monitor size={15} className="text-faint" aria-hidden="true" />
          Appearance
        </h2>
        <p className="mt-1 text-xs text-muted">Default is dark — the developer-tool standard.</p>
        <div role="radiogroup" aria-label="Theme" className="mt-3 grid grid-cols-2 gap-2 sm:max-w-sm">
          {THEME_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-colors',
                theme === option.value
                  ? 'border-accent/50 bg-accent/5 text-fg'
                  : 'text-muted hover:bg-raised hover:text-fg',
              )}
            >
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={theme === option.value}
                onChange={() => setTheme(option.value)}
                className="sr-only"
              />
              <option.icon size={15} aria-hidden="true" />
              {option.label}
            </label>
          ))}
        </div>
      </section>

      {/* Verification defaults */}
      <section className="card card-pad">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <SlidersHorizontal size={15} className="text-faint" aria-hidden="true" />
          Verification defaults
        </h2>
        <p className="mt-1 text-xs text-muted">
          Thresholds are configured per project so the same codebase always runs against the same
          budgets.
        </p>
        <dl className="mt-4 space-y-3">
          <div className="flex items-start justify-between gap-4 rounded-lg border px-3.5 py-3">
            <div>
              <dt className="text-sm font-medium text-fg">Load-test user budget</dt>
              <dd className="mt-0.5 text-xs text-muted">
                Ramped through 1 / 10 / 50 / 100 users up to the project budget.
              </dd>
            </div>
            <dd className="shrink-0 font-mono text-sm text-muted">per project</dd>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border px-3.5 py-3">
            <div>
              <dt className="text-sm font-medium text-fg">p95 latency budget</dt>
              <dd className="mt-0.5 text-xs text-muted">
                Checks fail when p95 crosses this line — the breaking point is charted.
              </dd>
            </div>
            <dd className="shrink-0 font-mono text-sm text-muted">per project</dd>
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border px-3.5 py-3">
            <div>
              <dt className="text-sm font-medium text-fg">Error-rate budget</dt>
              <dd className="mt-0.5 text-xs text-muted">
                Load levels above this error rate fail the run.
              </dd>
            </div>
            <dd className="shrink-0 font-mono text-sm text-muted">per project</dd>
          </div>
        </dl>
        <Link
          to="/projects"
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium text-fg transition-colors hover:bg-raised"
        >
          <FolderGit2 size={14} aria-hidden="true" />
          Manage {projectsQuery.data ? projectsQuery.data.total : ''} projects
        </Link>
      </section>

      {/* Session / security */}
      <section className="card card-pad">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <KeyRound size={15} className="text-faint" aria-hidden="true" />
          Session &amp; security
        </h2>
        <ul className="mt-3 space-y-2 text-sm text-muted">
          <li className="flex items-start gap-2.5">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden="true" />
            Access tokens are kept in memory only — never in localStorage — and refresh through an
            httpOnly cookie.
          </li>
          <li className="flex items-start gap-2.5">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-500" aria-hidden="true" />
            Artifact downloads use short-lived signed URLs; tokens never appear in URLs.
          </li>
        </ul>
        <Button
          variant="danger"
          className="mt-4"
          icon={<LogOut size={15} />}
          loading={isLoggingOut}
          onClick={() =>
            logout(undefined, {
              onSettled: () => navigate('/login', { replace: true }),
            })
          }
        >
          Sign out
        </Button>
        <p className="mt-2 text-xs text-faint">
          Signing out revokes the refresh cookie server-side and clears all cached data.
        </p>
      </section>

      {user?.role === 'admin' ? (
        <p className="flex items-center gap-2 text-xs text-faint">
          <ShieldCheck size={13} className="text-accent" aria-hidden="true" />
          You’re an admin — this page is restricted to admins by the route guard.
        </p>
      ) : null}
    </div>
  )
}
