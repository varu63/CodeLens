import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  Circle,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  MinusCircle,
  XCircle,
} from 'lucide-react'
import { useRunArtifact } from '../../hooks/useRuns'
import { cn, formatBytes, formatDuration, pluralize } from '../../utils/format'
import { CHECK_TYPE_LABELS } from '../../utils/severity'
import type { Check, CheckStatus, CheckType } from '../../types/domain.types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Modal } from '../ui/Modal'
import { Skeleton } from '../ui/Skeleton'
import { Table } from '../ui/Table'
import type { Column } from '../ui/Table'

const STATUS_ICON: Record<CheckStatus, { icon: typeof Circle; className: string; label: string }> = {
  queued: { icon: Circle, className: 'text-faint', label: 'Queued' },
  running: { icon: Loader2, className: 'text-blue-500 animate-spin', label: 'Running' },
  passed: { icon: CheckCircle2, className: 'text-emerald-500', label: 'Passed' },
  failed: { icon: XCircle, className: 'text-red-500', label: 'Failed' },
  skipped: { icon: MinusCircle, className: 'text-faint', label: 'Skipped' },
}

function CheckStatusIcon({ status }: { status: CheckStatus }) {
  const meta = STATUS_ICON[status]
  const Icon = meta.icon
  return <Icon size={16} className={cn('shrink-0', meta.className)} role="img" aria-label={meta.label} />
}

/* ------------------------------ Artifact viewer ----------------------------- */

function ArtifactModal({
  runId,
  artifactId,
  onClose,
}: {
  runId: string
  artifactId: string | null
  onClose: () => void
}) {
  const artifactQuery = useRunArtifact(runId, artifactId)
  const data = artifactQuery.data

  return (
    <Modal
      open={artifactId != null}
      onClose={onClose}
      size="lg"
      title={data?.artifact.name ?? 'Loading artifact…'}
      description={
        data
          ? `${data.artifact.kind.toUpperCase()} · ${formatBytes(data.artifact.sizeBytes)} · signed URL, expires in 15 min`
          : 'Fetching a short-lived signed URL…'
      }
      footer={
        data ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <a
              href={data.url}
              target="_blank"
              rel="noreferrer noopener"
              download={data.artifact.name}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover dark:text-bg"
            >
              <Download size={14} aria-hidden="true" />
              Download
            </a>
          </>
        ) : undefined
      }
    >
      {artifactQuery.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : artifactQuery.isError || !data ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-500">
          Could not load this artifact.{' '}
          <button type="button" className="link font-medium" onClick={() => void artifactQuery.refetch()}>
            Retry
          </button>
        </div>
      ) : data.artifact.kind === 'screenshot' ? (
        <figure>
          <img
            src={data.url}
            alt={data.artifact.name}
            className="w-full rounded-lg border bg-sunken object-contain"
          />
          <figcaption className="mt-2 text-xs text-faint">
            Captured during the run ·{' '}
            <a href={data.url} target="_blank" rel="noreferrer noopener" className="link">
              open full size <ExternalLink size={11} className="inline" aria-hidden="true" />
            </a>
          </figcaption>
        </figure>
      ) : data.content ? (
        <pre className="code-block max-h-[26rem] whitespace-pre-wrap">{data.content}</pre>
      ) : (
        <div className="rounded-lg border border-dashed px-6 py-10 text-center text-sm text-muted">
          This artifact is binary. Use the download button to inspect it.
        </div>
      )}
    </Modal>
  )
}

/* --------------------------------- CheckList -------------------------------- */

const FILTERS: { key: CheckType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'structure', label: 'Structure' },
  { key: 'existing_tests', label: 'Tests' },
  { key: 'api', label: 'API' },
  { key: 'e2e', label: 'E2E' },
  { key: 'data_fetch', label: 'Data' },
  { key: 'data_mapping', label: 'Mapping' },
  { key: 'db', label: 'DB' },
  { key: 'load', label: 'Load' },
  { key: 'security', label: 'Security' },
]

export interface CheckListProps {
  runId: string
  checks: Check[]
  loading?: boolean
  className?: string
}

export function CheckList({ runId, checks, loading = false, className }: CheckListProps) {
  const [filter, setFilter] = useState<CheckType | 'all'>('all')
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null)

  const counts = useMemo(() => {
    const map = new Map<CheckType | 'all', number>([['all', checks.length]])
    for (const check of checks) map.set(check.type, (map.get(check.type) ?? 0) + 1)
    return map
  }, [checks])

  const filtered = filter === 'all' ? checks : checks.filter((check) => check.type === filter)

  const columns: Column<Check>[] = [
    {
      key: 'status',
      header: 'Status',
      className: 'w-12',
      render: (check) => <CheckStatusIcon status={check.status} />,
    },
    {
      key: 'name',
      header: 'Check',
      render: (check) => (
        <div className="min-w-0 max-w-lg">
          <p className="truncate text-sm font-medium text-fg" title={check.name}>
            {check.name}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11.5px] text-faint" title={check.command}>
            {check.command}
          </p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (check) => <Badge variant="muted">{CHECK_TYPE_LABELS[check.type] ?? check.type}</Badge>,
    },
    {
      key: 'duration',
      header: 'Duration',
      className: 'hidden sm:table-cell',
      headerClassName: 'hidden sm:table-cell',
      render: (check) => (
        <span className="whitespace-nowrap text-xs tabular-nums text-muted">
          {formatDuration(check.durationMs)}
        </span>
      ),
    },
    {
      key: 'exitCode',
      header: 'Exit',
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
      render: (check) =>
        check.exitCode == null ? (
          <span className="text-xs text-faint">—</span>
        ) : (
          <code
            className={cn(
              'rounded px-1.5 py-0.5 font-mono text-[11px]',
              check.exitCode === 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-red-500/10 text-red-500',
            )}
          >
            {check.exitCode}
          </code>
        ),
    },
    {
      key: 'message',
      header: 'Note',
      className: 'hidden xl:table-cell',
      headerClassName: 'hidden xl:table-cell',
      render: (check) =>
        check.message ? (
          <span
            className={cn(
              'block max-w-[16rem] truncate text-xs',
              check.status === 'failed' ? 'text-red-500' : 'text-muted',
            )}
            title={check.message}
          >
            {check.message}
          </span>
        ) : (
          <span className="text-xs text-faint">—</span>
        ),
    },
    {
      key: 'artifacts',
      header: 'Logs',
      align: 'right',
      render: (check) =>
        check.artifactIds.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<FileText size={13} />}
            onClick={(event) => {
              event.stopPropagation()
              setOpenArtifactId(check.artifactIds[0])
            }}
          >
            View
          </Button>
        ) : (
          <span className="text-xs text-faint">—</span>
        ),
    },
  ]

  return (
    <div className={className}>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter checks by type">
        {FILTERS.map((item) => {
          const count = counts.get(item.key) ?? 0
          const disabled = item.key !== 'all' && count === 0
          return (
            <button
              key={item.key}
              type="button"
              disabled={disabled}
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                filter === item.key
                  ? 'border-accent/40 bg-accent/15 text-accent'
                  : 'border-border bg-surface text-muted hover:bg-raised hover:text-fg',
              )}
            >
              {item.label}
              <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      <Table
        columns={columns}
        rows={filtered}
        rowKey={(check) => check.id}
        loading={loading}
        skeletonRows={6}
        empty={
          <EmptyState
            title={filter === 'all' ? 'No checks recorded yet' : `No ${CHECK_TYPE_LABELS[filter]} checks`}
            description={
              filter === 'all'
                ? 'Checks appear here as soon as the run starts executing.'
                : 'This run has no checks of this type.'
            }
          />
        }
        caption={`${pluralize(filtered.length, 'check')} shown`}
      />

      <ArtifactModal runId={runId} artifactId={openArtifactId} onClose={() => setOpenArtifactId(null)} />
    </div>
  )
}
