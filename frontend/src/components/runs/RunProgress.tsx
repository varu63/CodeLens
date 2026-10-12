import { CheckCircle2, Circle, CircleDashed, Loader2, MinusCircle, XCircle } from 'lucide-react'
import { cn } from '../../utils/format'
import { STAGE_LABELS } from '../../utils/severity'
import { RUN_STAGE_ORDER } from '../../types/domain.types'
import type { CheckStatus, RunStageProgress } from '../../types/domain.types'

const STAGE_ICONS: Record<CheckStatus, { icon: typeof Circle; className: string }> = {
  queued: { icon: Circle, className: 'text-faint' },
  running: { icon: Loader2, className: 'text-blue-500 animate-spin' },
  passed: { icon: CheckCircle2, className: 'text-emerald-500' },
  failed: { icon: XCircle, className: 'text-red-500' },
  skipped: { icon: MinusCircle, className: 'text-faint' },
}

export interface RunProgressProps {
  stages: RunStageProgress[]
  className?: string
}

/**
 * The 8 verification stages with live status icons.
 * Announced politely to screen readers as stages advance.
 */
export function RunProgress({ stages, className }: RunProgressProps) {
  if (stages.length === 0) {
    // Fall back to the full stage list so the layout doesn't jump.
    return (
      <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', className)}>
        {RUN_STAGE_ORDER.map((stage) => (
          <div key={stage} className="flex items-center gap-2 rounded-lg border bg-surface px-3 py-2.5">
            <CircleDashed size={15} className="shrink-0 text-faint" aria-hidden="true" />
            <span className="text-[13px] font-medium text-muted">{STAGE_LABELS[stage]}</span>
          </div>
        ))}
      </div>
    )
  }

  const done = stages.filter((stage) => stage.status === 'passed' || stage.status === 'failed').length
  const percent = Math.round((done / stages.length) * 100)

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          <span className="tabular-nums">{done}</span> of {stages.length} stages complete
        </p>
        <p className="text-xs tabular-nums text-faint">{percent}%</p>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Run progress"
        className="mb-4 h-1.5 overflow-hidden rounded-full bg-raised"
      >
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol aria-live="polite" className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {stages.map((stage) => {
          const meta = STAGE_ICONS[stage.status]
          const Icon = meta.icon
          return (
            <li
              key={stage.stage}
              className={cn(
                'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors',
                stage.status === 'running' && 'border-blue-500/40 bg-blue-500/5',
                stage.status === 'failed' && 'border-red-500/30 bg-red-500/5',
                stage.status === 'passed' && 'bg-surface',
                (stage.status === 'queued' || stage.status === 'skipped') && 'bg-surface opacity-80',
              )}
            >
              <Icon size={15} className={cn('mt-0.5 shrink-0', meta.className)} aria-hidden="true" />
              <span className="min-w-0">
                <span
                  className={cn(
                    'block truncate text-[13px] font-medium',
                    stage.status === 'queued' ? 'text-muted' : 'text-fg',
                  )}
                >
                  {STAGE_LABELS[stage.stage]}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-faint" title={stage.message}>
                  {stage.message ??
                    (stage.status === 'running'
                      ? 'In progress…'
                      : stage.status === 'passed'
                        ? 'Passed'
                        : stage.status === 'failed'
                          ? 'Failed'
                          : stage.status === 'skipped'
                            ? 'Skipped'
                            : 'Waiting')}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
