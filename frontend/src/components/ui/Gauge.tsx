import { cn } from '../../utils/format'
import { healthMeta } from '../../utils/severity'

export interface GaugeProps {
  /** 0–100 health score. */
  value: number | null
  size?: number
  strokeWidth?: number
  label?: string
  className?: string
}

/**
 * Circular health-score gauge (SVG, no chart library needed).
 * Color follows the shared health thresholds: >=85 green, >=65 amber, else red.
 */
export function Gauge({ value, size = 96, strokeWidth = 8, label, className }: GaugeProps) {
  const meta = healthMeta(value)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const progress = value == null ? 0 : Math.max(0, Math.min(100, value))
  const dashOffset = circumference * (1 - progress / 100)

  return (
    <div className={cn('inline-flex flex-col items-center', className)} role="img" aria-label={`Health score ${value ?? 'unknown'} out of 100${label ? `, ${label}` : ''}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            className="stroke-raised"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            stroke={meta.strokeColor}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 700ms ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-xl font-semibold tabular-nums', meta.textClass)}>
            {value == null ? '—' : Math.round(value)}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-faint">/ 100</span>
        </div>
      </div>
      {label ? <p className={cn('mt-1.5 text-xs font-medium', meta.textClass)}>{label}</p> : null}
    </div>
  )
}
