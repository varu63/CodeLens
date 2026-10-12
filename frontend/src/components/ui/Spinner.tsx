import { Loader2 } from 'lucide-react'
import { cn } from '../../utils/format'

const SIZE_CLASSES = { sm: 14, md: 20, lg: 32 } as const

export function Spinner({
  size = 'md',
  className,
  label,
}: {
  size?: keyof typeof SIZE_CLASSES
  className?: string
  label?: string
}) {
  return (
    <span role={label ? 'status' : undefined} aria-label={label ?? undefined} className={cn('inline-flex items-center gap-2 text-muted', className)}>
      <Loader2 aria-hidden="true" className="animate-spin" size={SIZE_CLASSES[size]} />
      {label ? <span className="text-sm">{label}</span> : null}
    </span>
  )
}

export function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted" role="status">
      <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-accent" />
      <p className="text-sm">{label}</p>
    </div>
  )
}
