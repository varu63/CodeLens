import { ShieldAlert } from 'lucide-react'
import { cn } from '../../utils/format'
import type { CommitRisk } from '../../types/domain.types'

const RISK_META: Record<CommitRisk['level'], { label: string; className: string }> = {
  low: {
    label: 'Low risk',
    className: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  medium: {
    label: 'Medium risk',
    className: 'border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  high: {
    label: 'High risk',
    className: 'border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400',
  },
}

export function CommitRiskBadge({ risk, className }: { risk: CommitRisk; className?: string }) {
  const meta = RISK_META[risk.level]
  return (
    <span
      title={risk.signals.map((signal) => signal.label).join(' · ') || undefined}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        meta.className,
        className,
      )}
    >
      {risk.level === 'high' ? (
        <ShieldAlert size={12} aria-hidden="true" />
      ) : (
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {meta.label}
      <span className="tabular-nums opacity-70">{risk.score}</span>
    </span>
  )
}
