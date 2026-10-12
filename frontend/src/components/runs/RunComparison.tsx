import { Link } from 'react-router-dom'
import { ArrowRight, CheckCheck, MinusCircle, Sparkles } from 'lucide-react'
import type { Finding } from '../../types/domain.types'
import { cn } from '../../utils/format'
import { compareFindings } from '../../utils/comparison'
import { CATEGORY_LABELS } from '../../utils/severity'
import { SeverityBadge } from '../ui/Badge'

type Bucket = 'fixed' | 'still_failing' | 'new'

const BUCKETS: {
  key: Bucket
  title: string
  icon: typeof CheckCheck
  className: string
  dotClass: string
}[] = [
  { key: 'fixed', title: 'Fixed', icon: CheckCheck, className: 'border-emerald-500/30 bg-emerald-500/5', dotClass: 'bg-emerald-500' },
  { key: 'still_failing', title: 'Still failing', icon: MinusCircle, className: 'border-red-500/30 bg-red-500/5', dotClass: 'bg-red-500' },
  { key: 'new', title: 'New', icon: Sparkles, className: 'border-amber-500/30 bg-amber-500/5', dotClass: 'bg-amber-400' },
]

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <li>
      <Link
        to={`/findings/${finding.id}`}
        className="group flex items-start gap-2.5 rounded-lg border bg-surface px-3 py-2.5 transition-colors hover:border-faint/70"
      >
        <SeverityBadge severity={finding.severity} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-fg group-hover:text-accent" title={finding.title}>
            {finding.title}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-faint">
            {CATEGORY_LABELS[finding.category]}
            {finding.clusterSize && finding.clusterSize > 1
              ? ` · ${finding.clusterSize} failures, 1 root cause`
              : ''}
          </span>
        </span>
        <ArrowRight size={13} className="mt-1 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </Link>
    </li>
  )
}

export interface RunComparisonProps {
  current: Finding[]
  previous: Finding[]
  previousRunId: string
  className?: string
}

/**
 * Before/after comparison shown on rerun pages:
 * what got fixed, what is still failing and what is new.
 */
export function RunComparison({ current, previous, previousRunId, className }: RunComparisonProps) {
  const result = compareFindings(current, previous)
  const buckets: Record<Bucket, Finding[]> = {
    fixed: result.fixed,
    still_failing: result.stillFailing,
    new: result.created,
  }

  return (
    <div className={className}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted">
          Compared with{' '}
          <Link to={`/runs/${previousRunId}`} className="link font-medium">
            the previous run
          </Link>{' '}
          by root-cause fingerprint.
        </p>
        <p className="text-xs text-faint">
          {result.fixed.length} fixed · {result.stillFailing.length} still failing · {result.created.length} new
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {BUCKETS.map((bucket) => {
          const findings = buckets[bucket.key]
          const Icon = bucket.icon
          return (
            <section key={bucket.key} className={cn('rounded-xl border p-4', bucket.className)}>
              <header className="mb-3 flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                  <Icon size={15} className="text-muted" aria-hidden="true" />
                  {bucket.title}
                </h3>
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', bucket.dotClass)} />
                  {findings.length}
                </span>
              </header>
              {findings.length === 0 ? (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-faint">
                  {bucket.key === 'fixed'
                    ? 'No findings were confirmed fixed in this rerun.'
                    : bucket.key === 'still_failing'
                      ? 'Nothing from the previous run is still failing.'
                      : 'No new findings appeared.'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {findings.map((finding) => (
                    <FindingRow key={finding.fingerprint} finding={finding} />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-faint">
        “Fixed” is proven, not inferred: the same check pipeline re-ran and those failures no longer
        reproduce.
      </p>
    </div>
  )
}
