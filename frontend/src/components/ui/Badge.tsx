import type { ReactNode } from 'react'
import { cn } from '../../utils/format'
import { CHECK_STATUS_META, RUN_STATUS_META, SEVERITY_META } from '../../utils/severity'
import type { CheckStatus, RunStatus, Severity } from '../../types/domain.types'

type BadgeVariant = 'default' | 'accent' | 'success' | 'danger' | 'warning' | 'info' | 'muted'

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: 'border-border bg-raised text-muted',
  accent: 'border-accent/30 bg-accent/15 text-accent',
  success: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  danger: 'border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400',
  warning: 'border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400',
  info: 'border-blue-500/30 bg-blue-500/15 text-blue-600 dark:text-blue-400',
  muted: 'border-border bg-raised text-faint',
}

export interface BadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  className?: string
  title?: string
  /** Show a small leading status dot. */
  dot?: boolean
}

export function Badge({ children, variant = 'default', className, title, dot = false }: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  )
}

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const meta = SEVERITY_META[severity]
  return (
    <Badge className={cn(meta.badgeClass, className)} dot>
      {meta.label}
    </Badge>
  )
}

export function RunStatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  const meta = RUN_STATUS_META[status]
  return (
    <Badge className={cn(meta.badgeClass, className)} dot>
      {meta.label}
    </Badge>
  )
}

export function CheckStatusBadge({ status, className }: { status: CheckStatus; className?: string }) {
  const meta = CHECK_STATUS_META[status]
  return (
    <Badge className={cn(meta.badgeClass, className)} dot>
      {meta.label}
    </Badge>
  )
}
