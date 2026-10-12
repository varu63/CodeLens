import type { ReactNode } from 'react'
import { AlertCircle, Inbox, RotateCw } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from './Button'
import { cn } from '../../utils/format'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center', className)}>
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-raised">
        <Icon aria-hidden="true" size={20} className="text-faint" />
      </div>
      <h3 className="mt-4 text-sm font-semibold text-fg">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export interface ErrorStateProps {
  title?: string
  message?: string
  onRetry?: () => void
  className?: string
}

export function ErrorState({ title = 'Something went wrong', message, onRetry, className }: ErrorStateProps) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center rounded-xl border border-red-500/30 bg-red-500/5 px-6 py-10 text-center', className)}>
      <AlertCircle aria-hidden="true" size={22} className="text-red-500" />
      <h3 className="mt-3 text-sm font-semibold text-fg">{title}</h3>
      {message ? <p className="mt-1 max-w-md text-sm text-muted">{message}</p> : null}
      {onRetry ? (
        <Button className="mt-5" size="sm" icon={<RotateCw size={14} />} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  )
}
