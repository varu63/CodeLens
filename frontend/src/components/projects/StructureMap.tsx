import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Boxes,
  Braces,
  CheckCircle2,
  Database,
  FileCode2,
  Search,
  ShieldQuestion,
  Unlock,
  User as UserIcon,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { StructureMap as StructureMapData, AuthLevel, EndpointInfo } from '../../types/domain.types'
import { cn, pluralize, truncateMiddle } from '../../utils/format'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'

const METHOD_CLASSES: Record<string, string> = {
  GET: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  POST: 'border-blue-500/30 bg-blue-500/15 text-blue-600 dark:text-blue-400',
  PUT: 'border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400',
  PATCH: 'border-violet-500/30 bg-violet-500/15 text-violet-600 dark:text-violet-400',
  DELETE: 'border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400',
}

const AUTH_META: Record<AuthLevel, { label: string; className: string; icon: LucideIcon }> = {
  public: { label: 'Public', className: 'border-border bg-raised text-muted', icon: Unlock },
  user: { label: 'User auth', className: 'border-blue-500/30 bg-blue-500/15 text-blue-600 dark:text-blue-400', icon: UserIcon },
  admin: { label: 'Admin only', className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', icon: ShieldQuestion },
  'none-detected': { label: 'Auth unknown', className: 'border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400', icon: ShieldQuestion },
}

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={cn(
        'inline-flex w-14 justify-center rounded border px-1.5 py-0.5 font-mono text-[11px] font-semibold',
        METHOD_CLASSES[method.toUpperCase()] ?? 'border-border bg-raised text-muted',
      )}
    >
      {method.toUpperCase()}
    </span>
  )
}

function AuthBadge({ level }: { level: AuthLevel }) {
  const meta = AUTH_META[level]
  const Icon = meta.icon
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', meta.className)}>
      <Icon size={11} aria-hidden="true" />
      {meta.label}
    </span>
  )
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'routes', label: 'Endpoints' },
  { key: 'apiCalls', label: 'API calls' },
  { key: 'tables', label: 'Tables' },
  { key: 'components', label: 'Components' },
] as const

type TabKey = (typeof TABS)[number]['key']

export interface StructureMapProps {
  data: StructureMapData
  className?: string
}

export function StructureMap({ data, className }: StructureMapProps) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<TabKey>('all')
  const search = query.trim().toLowerCase()

  const matches = (value: string | undefined) => !search || (value ?? '').toLowerCase().includes(search)

  const filtered = useMemo(() => {
    const routes = data.routes.filter(
      (route: EndpointInfo) =>
        matches(route.path) || matches(route.file) || matches(route.method) || matches(route.issue),
    )
    const apiCalls = data.apiCalls.filter(
      (call) => matches(call.from) || matches(call.path) || matches(call.note),
    )
    const tables = data.tables.filter(
      (table) => matches(table.name) || table.columns.some((column) => matches(column.name)),
    )
    const components = data.components.filter(
      (component) => matches(component.name) || matches(component.path),
    )
    return { routes, apiCalls, tables, components }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, search])

  const counts: Record<TabKey, number> = {
    all: filtered.routes.length + filtered.apiCalls.length + filtered.tables.length + filtered.components.length,
    routes: filtered.routes.length,
    apiCalls: filtered.apiCalls.length,
    tables: filtered.tables.length,
    components: filtered.components.length,
  }

  const show = (key: TabKey) => tab === 'all' || tab === key
  const nothingMatches = counts.all === 0

  return (
    <div className={cn('space-y-4', className)}>
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search routes, tables, files…"
            aria-label="Search structure map"
            className="input w-full pl-9"
          />
        </div>
        <div role="group" aria-label="Filter structure sections" className="flex flex-wrap gap-1.5">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={tab === item.key}
              onClick={() => setTab(item.key)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                tab === item.key
                  ? 'border-accent/40 bg-accent/15 text-accent'
                  : 'border-border bg-surface text-muted hover:bg-raised hover:text-fg',
              )}
            >
              {item.label}
              <span className="ml-1.5 tabular-nums opacity-70">{counts[item.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {nothingMatches ? (
        <EmptyState
          icon={Search}
          title="No matches"
          description={`Nothing in the structure map matches “${query.trim()}”. Try a different search term.`}
        />
      ) : (
        <div className="space-y-6">
          {/* Endpoints */}
          {show('routes') && filtered.routes.length > 0 ? (
            <Section
              icon={Braces}
              title="Endpoints"
              subtitle={pluralize(data.routes.length, 'route')}
            >
              <ul className="divide-y">
                {filtered.routes.map((route) => (
                  <li key={`${route.method} ${route.path}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <MethodBadge method={route.method} />
                    <code className="min-w-0 flex-1 truncate font-mono text-sm text-fg">{route.path}</code>
                    <AuthBadge level={route.auth} />
                    <span className="hidden max-w-[14rem] truncate text-xs text-faint sm:block" title={route.file}>
                      {route.file}
                    </span>
                    {route.issue ? (
                      <span className="flex w-full items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                        <AlertTriangle size={12} aria-hidden="true" />
                        {route.issue}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {/* API calls */}
          {show('apiCalls') && filtered.apiCalls.length > 0 ? (
            <Section
              icon={FileCode2}
              title="Frontend → API calls"
              subtitle={pluralize(data.apiCalls.length, 'call')}
            >
              <ul className="divide-y">
                {filtered.apiCalls.map((call) => (
                  <li key={`${call.from} ${call.method} ${call.path}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      {call.status === 'ok' ? (
                        <CheckCircle2 size={15} className="text-emerald-500" aria-label="Working" />
                      ) : (
                        <XCircle size={15} className="text-red-500" aria-label="Broken" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-fg" title={call.from}>
                      <span className="text-muted">{truncateMiddle(call.from, 42)}</span>
                      <span className="mx-2 text-faint">calls</span>
                      <span className="font-mono text-[13px]">
                        {call.method.toUpperCase()} {call.path}
                      </span>
                    </span>
                    {call.note ? (
                      <span className="w-full text-xs text-red-500 sm:w-auto">{call.note}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {/* Tables */}
          {show('tables') && filtered.tables.length > 0 ? (
            <Section icon={Database} title="Database tables" subtitle={pluralize(data.tables.length, 'table')}>
              <ul className="divide-y">
                {filtered.tables.map((table) => (
                  <li key={table.name} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                    <code className="font-mono text-sm text-fg">{table.name}</code>
                    <Badge>{pluralize(table.columns.length, 'column')}</Badge>
                    {table.relations.length > 0 ? (
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
                        relates to
                        {table.relations.map((relation) => (
                          <code key={relation} className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted">
                            {relation}
                          </code>
                        ))}
                      </span>
                    ) : null}
                    <span className="w-full truncate font-mono text-[11px] text-faint" title={table.columns.map((column) => column.name).join(', ')}>
                      {table.columns.map((column) => column.name).join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {/* Components */}
          {show('components') && filtered.components.length > 0 ? (
            <Section
              icon={Boxes}
              title="Components & modules"
              subtitle={pluralize(data.components.length, 'component')}
            >
              <ul className="divide-y">
                {filtered.components.map((component) => (
                  <li key={`${component.kind} ${component.path}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                    <Badge variant="muted" className="capitalize">
                      {component.kind}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{component.name}</span>
                    <span className="w-full truncate font-mono text-xs text-faint sm:w-auto" title={component.path}>
                      {component.path}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: typeof Braces
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-surface">
      <header className="flex items-center justify-between gap-3 border-b bg-raised/50 px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Icon size={15} className="text-faint" aria-hidden="true" />
          {title}
        </h3>
        <span className="text-xs text-faint">{subtitle}</span>
      </header>
      {children}
    </section>
  )
}
