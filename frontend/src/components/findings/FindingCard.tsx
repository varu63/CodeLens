import { Link } from 'react-router-dom'
import { ArrowRight, FileWarning, GitCompareArrows, Layers } from 'lucide-react'
import type { Finding } from '../../types/domain.types'
import { cn, confidenceLabel, formatPercent, pluralize } from '../../utils/format'
import { CATEGORY_LABELS, SEVERITY_META, compareSeverity } from '../../utils/severity'
import { Badge, SeverityBadge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'
import { Skeleton } from '../ui/Skeleton'

const COMPARISON_META = {
  fixed: { label: 'Fixed', className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  still_failing: { label: 'Still failing', className: 'border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400' },
  new: { label: 'New', className: 'border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400' },
} as const

export function FindingCard({ finding, className }: { finding: Finding; className?: string }) {
  const severity = SEVERITY_META[finding.severity]
  const confidence = confidenceLabel(finding.confidence)
  const comparison = finding.comparisonStatus ? COMPARISON_META[finding.comparisonStatus] : null
  const location = finding.filePath
    ? `${finding.filePath}${finding.line ? `:${finding.line}` : ''}`
    : finding.endpoint ?? finding.table

  return (
    <Link
      to={`/findings/${finding.id}`}
      className={cn(
        'group block rounded-xl border border-l-4 bg-surface p-4 shadow-sm transition-colors hover:border-faint/70',
        severity.borderClass,
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={finding.severity} />
        <Badge variant="muted">{CATEGORY_LABELS[finding.category]}</Badge>
        {comparison ? <Badge className={comparison.className}>{comparison.label}</Badge> : null}
        {!finding.evidenceValidated ? (
          <Badge variant="warning" dot title="Evidence could not be validated by a re-run">
            Unexplained
          </Badge>
        ) : null}
        {finding.clusterId && finding.clusterSize && finding.clusterSize > 1 ? (
          <Badge variant="info" title={`Cluster ${finding.clusterId}`}>
            <Layers size={11} aria-hidden="true" />
            {finding.clusterSize} failures, 1 root cause
          </Badge>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-faint">
          confidence
          <span
            className={cn(
              'font-semibold',
              confidence === 'High' ? 'text-emerald-500' : confidence === 'Medium' ? 'text-amber-500' : 'text-red-400',
            )}
          >
            {formatPercent(finding.confidence * 100, 0)}
          </span>
        </span>
      </div>

      <h3 className="mt-3 text-sm font-semibold text-fg group-hover:text-accent">{finding.title}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-muted">{finding.description}</p>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-faint">
        {location ? (
          <span className="inline-flex items-center gap-1.5 font-mono" title={location}>
            <FileWarning size={12} aria-hidden="true" />
            {location}
          </span>
        ) : null}
        <span className="inline-flex items-center gap-1.5">
          <GitCompareArrows size={12} aria-hidden="true" />
          {pluralize(finding.evidence.length, 'evidence item')}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 font-medium text-accent opacity-0 transition-opacity group-hover:opacity-100">
          Open finding <ArrowRight size={12} aria-hidden="true" />
        </span>
      </div>
    </Link>
  )
}

/* --------------------------- Grouped findings list -------------------------- */

export interface FindingsListProps {
  findings: Finding[]
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  className?: string
}

/**
 * Severity-sorted findings. Findings sharing a clusterId are grouped under a
 * single "N failures, 1 root cause" header.
 */
export function FindingsList({
  findings,
  loading = false,
  emptyTitle = 'No findings',
  emptyDescription = 'Every check passed — nothing to explain.',
  className,
}: FindingsListProps) {
  if (loading && findings.length === 0) {
    return (
      <div className={cn('space-y-3', className)}>
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-l-4 border-l-raised p-4">
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="ml-auto h-5 w-24" />
            </div>
            <Skeleton className="mt-3 h-4 w-3/4" />
            <Skeleton className="mt-2 h-3.5 w-full" />
          </div>
        ))}
      </div>
    )
  }

  if (findings.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} className={className} />
  }

  // Group by clusterId, preserving severity sort at the group level.
  const clusters = new Map<string, Finding[]>()
  const standalone: Finding[] = []
  for (const finding of findings) {
    if (finding.clusterId && (finding.clusterSize ?? 1) > 1) {
      const group = clusters.get(finding.clusterId) ?? []
      group.push(finding)
      clusters.set(finding.clusterId, group)
    } else {
      standalone.push(finding)
    }
  }

  const sortFindings = (list: Finding[]) =>
    [...list].sort((a, b) => compareSeverity(a.severity, b.severity))

  const clusterGroups = [...clusters.entries()]
    .map(([clusterId, group]) => ({ clusterId, group: sortFindings(group) }))
    .sort((a, b) => compareSeverity(a.group[0].severity, b.group[0].severity))

  return (
    <div className={cn('space-y-5', className)}>
      {clusterGroups.map(({ clusterId, group }) => (
        <section key={clusterId} className="rounded-2xl border border-dashed bg-raised/30 p-4">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <Layers size={15} className="text-accent" aria-hidden="true" />
              {group.length} failures share one root cause
            </h3>
            <Badge variant="accent" title={`Cluster ${clusterId}`}>
              cluster {clusterId}
            </Badge>
          </header>
          <div className="space-y-3">
            {group.map((finding) => (
              <FindingCard key={finding.id} finding={finding} />
            ))}
          </div>
        </section>
      ))}

      {standalone.length > 0 ? (
        <div className="space-y-3">
          {sortFindings(standalone).map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
