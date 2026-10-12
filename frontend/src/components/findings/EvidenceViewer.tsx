import { useState } from 'react'
import { AlertTriangle, Camera, FileDiff, Globe, ScrollText } from 'lucide-react'
import type { Evidence } from '../../types/domain.types'
import { cn, pluralize } from '../../utils/format'
import { EmptyState } from '../ui/EmptyState'

const KIND_META: Record<Evidence['kind'], { label: string; icon: typeof ScrollText }> = {
  log: { label: 'Log', icon: ScrollText },
  http: { label: 'HTTP', icon: Globe },
  screenshot: { label: 'Screenshot', icon: Camera },
  diff: { label: 'Diff', icon: FileDiff },
}

function statusPillClass(status: number): string {
  if (status >= 500) return 'border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400'
  if (status >= 400) return 'border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400'
  if (status >= 200 && status < 300) return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
  return 'border-border bg-raised text-muted'
}

function EvidenceBody({ item }: { item: Evidence }) {
  switch (item.kind) {
    case 'log':
      return (
        <div>
          <pre className="code-block max-h-[28rem] whitespace-pre-wrap">{item.content}</pre>
          {item.language ? (
            <p className="mt-2 text-[11px] uppercase tracking-wide text-faint">{item.language}</p>
          ) : null}
        </div>
      )
    case 'http':
      return (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border bg-raised px-2 py-0.5 font-mono text-xs font-semibold text-fg">
              {item.method.toUpperCase()}
            </span>
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{item.url}</code>
            <span className={cn('rounded border px-2 py-0.5 font-mono text-xs font-semibold', statusPillClass(item.status))}>
              {item.status} {item.statusText ?? ''}
            </span>
            {item.durationMs != null ? (
              <span className="text-xs tabular-nums text-faint">{item.durationMs} ms</span>
            ) : null}
          </div>
          {item.requestHeaders && Object.keys(item.requestHeaders).length > 0 ? (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-faint">Request headers</p>
              <div className="overflow-hidden rounded-lg border">
                {Object.entries(item.requestHeaders).map(([key, value]) => (
                  <div key={key} className="flex gap-4 border-b px-3 py-1.5 font-mono text-xs last:border-b-0">
                    <span className="w-44 shrink-0 text-faint">{key}</span>
                    <span className="min-w-0 truncate text-fg">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {item.requestBody ? (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-faint">Request body</p>
              <pre className="code-block max-h-48 whitespace-pre-wrap">{item.requestBody}</pre>
            </div>
          ) : null}
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-faint">Response body</p>
            <pre className="code-block max-h-72 whitespace-pre-wrap">{item.responseBody}</pre>
          </div>
        </div>
      )
    case 'screenshot':
      return (
        <figure>
          <img src={item.url} alt={item.title ?? 'Evidence screenshot'} className="w-full rounded-lg border bg-sunken object-contain" />
          {item.caption ? <figcaption className="mt-2 text-xs text-faint">{item.caption}</figcaption> : null}
        </figure>
      )
    case 'diff':
      return (
        <div>
          <p className="mb-1.5 font-mono text-xs text-faint">{item.filePath}</p>
          <pre className="code-block max-h-[28rem] p-0">
            {item.diff.split('\n').map((line, index) => (
              <span
                key={index}
                className={cn(
                  'block px-4',
                  line.startsWith('+') && !line.startsWith('+++') && 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  line.startsWith('-') && !line.startsWith('---') && 'bg-red-500/10 text-red-600 dark:text-red-400',
                  line.startsWith('@@') && 'text-accent',
                )}
              >
                {line || ' '}
              </span>
            ))}
          </pre>
        </div>
      )
  }
}

export interface EvidenceViewerProps {
  evidence: Evidence[]
  evidenceValidated: boolean
  className?: string
}

export function EvidenceViewer({ evidence, evidenceValidated, className }: EvidenceViewerProps) {
  const [selected, setSelected] = useState(0)

  if (evidence.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="No evidence attached"
        description={
          evidenceValidated
            ? 'This finding has no raw evidence items.'
            : 'Evidence could not be collected or validated for this finding.'
        }
        className={className}
      />
    )
  }

  const item = evidence[Math.min(selected, evidence.length - 1)]
  const meta = KIND_META[item.kind]
  const Icon = meta.icon

  return (
    <div className={className}>
      <div role="tablist" aria-label="Evidence items" className="mb-3 flex flex-wrap gap-1.5">
        {evidence.map((entry, index) => {
          const entryMeta = KIND_META[entry.kind]
          const EntryIcon = entryMeta.icon
          return (
            <button
              key={index}
              role="tab"
              aria-selected={index === selected}
              type="button"
              onClick={() => setSelected(index)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                index === selected
                  ? 'border-accent/40 bg-accent/15 text-accent'
                  : 'border-border bg-surface text-muted hover:bg-raised hover:text-fg',
              )}
            >
              <EntryIcon size={12} aria-hidden="true" />
              {entry.title ?? entryMeta.label}
              {evidence.length > 1 ? <span className="opacity-60">· {index + 1}</span> : null}
            </button>
          )
        })}
      </div>

      <div className="rounded-xl border bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-faint">
            <Icon size={13} aria-hidden="true" />
            {meta.label} · {item.title ?? `item ${selected + 1} of ${evidence.length}`}
          </p>
          <p className="text-[11px] text-faint">{pluralize(evidence.length, 'attached item')}</p>
        </div>
        <EvidenceBody item={item} />
      </div>
    </div>
  )
}
