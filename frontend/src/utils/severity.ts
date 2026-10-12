import type { CheckStatus, FindingCategory, RunStageKey, RunStatus, Severity } from '../types/domain.types'
import { RUN_STAGE_ORDER } from '../types/domain.types'

/**
 * Central color/label system.
 * All class strings are full literals so Tailwind's scanner picks them up.
 */

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low']

export interface SeverityMeta {
  label: string
  rank: number
  badgeClass: string
  dotClass: string
  textClass: string
  borderClass: string
  barClass: string
  chartColor: string
}

export const SEVERITY_META: Record<Severity, SeverityMeta> = {
  critical: {
    label: 'Critical',
    rank: 0,
    badgeClass: 'border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400',
    dotClass: 'bg-red-500',
    textClass: 'text-red-600 dark:text-red-400',
    borderClass: 'border-l-red-500',
    barClass: 'bg-red-500',
    chartColor: '#ef4444',
  },
  high: {
    label: 'High',
    rank: 1,
    badgeClass: 'border-orange-500/30 bg-orange-500/15 text-orange-600 dark:text-orange-400',
    dotClass: 'bg-orange-500',
    textClass: 'text-orange-600 dark:text-orange-400',
    borderClass: 'border-l-orange-500',
    barClass: 'bg-orange-500',
    chartColor: '#f97316',
  },
  medium: {
    label: 'Medium',
    rank: 2,
    badgeClass: 'border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-600 dark:text-amber-400',
    borderClass: 'border-l-amber-400',
    barClass: 'bg-amber-400',
    chartColor: '#f59e0b',
  },
  low: {
    label: 'Low',
    rank: 3,
    badgeClass: 'border-blue-500/30 bg-blue-500/15 text-blue-600 dark:text-blue-400',
    dotClass: 'bg-blue-500',
    textClass: 'text-blue-600 dark:text-blue-400',
    borderClass: 'border-l-blue-500',
    barClass: 'bg-blue-500',
    chartColor: '#3b82f6',
  },
}

export function severityRank(severity: Severity): number {
  return SEVERITY_META[severity].rank
}

export function compareSeverity(a: Severity, b: Severity): number {
  return severityRank(a) - severityRank(b)
}

export function maxSeverity(severities: Severity[]): Severity {
  return severities.reduce<Severity>(
    (worst, current) => (severityRank(current) < severityRank(worst) ? current : worst),
    'low',
  )
}

export const CATEGORY_LABELS: Record<FindingCategory, string> = {
  security: 'Security',
  api: 'API contract',
  mapping: 'Data mapping',
  database: 'Database',
  performance: 'Performance',
  data: 'Data integrity',
  configuration: 'Configuration',
}

/* ------------------------------ Run / check status ------------------------- */

export interface StatusMeta {
  label: string
  badgeClass: string
  dotClass: string
  textClass: string
}

export const RUN_STATUS_META: Record<RunStatus, StatusMeta> = {
  queued: {
    label: 'Queued',
    badgeClass: 'border-border bg-raised text-muted',
    dotClass: 'bg-faint',
    textClass: 'text-muted',
  },
  running: {
    label: 'Running',
    badgeClass: 'border-blue-500/30 bg-blue-500/15 text-blue-600 dark:text-blue-400',
    dotClass: 'bg-blue-500 animate-pulse-soft',
    textClass: 'text-blue-600 dark:text-blue-400',
  },
  passed: {
    label: 'Passed',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  },
  failed: {
    label: 'Failed',
    badgeClass: 'border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400',
    dotClass: 'bg-red-500',
    textClass: 'text-red-600 dark:text-red-400',
  },
  cancelled: {
    label: 'Cancelled',
    badgeClass: 'border-border bg-raised text-muted',
    dotClass: 'bg-faint',
    textClass: 'text-muted',
  },
}

export const CHECK_STATUS_META: Record<CheckStatus, StatusMeta> = {
  queued: RUN_STATUS_META.queued,
  running: RUN_STATUS_META.running,
  passed: RUN_STATUS_META.passed,
  failed: RUN_STATUS_META.failed,
  skipped: {
    label: 'Skipped',
    badgeClass: 'border-border bg-raised text-faint',
    dotClass: 'bg-faint',
    textClass: 'text-faint',
  },
}

/* --------------------------------- Stages ---------------------------------- */

export const STAGE_ORDER: RunStageKey[] = RUN_STAGE_ORDER

export const STAGE_LABELS: Record<RunStageKey, string> = {
  structure: 'Structure scan',
  existing_tests: 'Existing tests',
  api_tests: 'API tests',
  data_fetch: 'Data fetch',
  mapping: 'Data mapping',
  database: 'Database',
  load: 'Load test',
  security: 'Security baseline',
}

/* --------------------------------- Health ---------------------------------- */

export interface HealthMeta {
  label: string
  textClass: string
  strokeColor: string
  barClass: string
}

export function healthMeta(score: number | null | undefined): HealthMeta {
  if (score == null) {
    return { label: 'No data', textClass: 'text-muted', strokeColor: '#6b7280', barClass: 'bg-gray-500' }
  }
  if (score >= 85) {
    return { label: 'Healthy', textClass: 'text-emerald-600 dark:text-emerald-400', strokeColor: '#10b981', barClass: 'bg-emerald-500' }
  }
  if (score >= 65) {
    return { label: 'Needs attention', textClass: 'text-amber-600 dark:text-amber-400', strokeColor: '#f59e0b', barClass: 'bg-amber-400' }
  }
  return { label: 'At risk', textClass: 'text-red-600 dark:text-red-400', strokeColor: '#ef4444', barClass: 'bg-red-500' }
}

export const CHECK_TYPE_LABELS: Record<string, string> = {
  structure: 'Structure',
  existing_tests: 'Tests',
  api: 'API',
  e2e: 'E2E',
  data_fetch: 'Data',
  data_mapping: 'Mapping',
  db: 'DB',
  load: 'Load',
  security: 'Security',
}
