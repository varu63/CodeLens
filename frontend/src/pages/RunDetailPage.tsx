import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Activity,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Download,
  FileJson,
  FileText,
  GitCommitHorizontal,
  GitCompareArrows,
  Loader2,
  PlayCircle,
  RotateCw,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react'
import { useRun, useRunChecks, useRunFindings, useRunLoadTest, useRunStream, mergeById, mergeStages } from '../hooks/useRunStream'
import { useCancelRun, useDownloadReport, useRerunRun } from '../hooks/useRuns'
import { getErrorMessage } from '../api/client'
import { CheckList } from '../components/runs/CheckList'
import { LoadChart } from '../components/runs/LoadChart'
import { RunComparison } from '../components/runs/RunComparison'
import { RunProgress } from '../components/runs/RunProgress'
import { FindingsList } from '../components/findings/FindingCard'
import { Badge, RunStatusBadge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { ErrorState } from '../components/ui/EmptyState'
import { Gauge } from '../components/ui/Gauge'
import { Skeleton, SkeletonTable } from '../components/ui/Skeleton'
import { toast } from '../components/ui/Toast'
import {
  cn,
  downloadBlob,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatRelativeTime,
  pluralize,
} from '../utils/format'
import { SEVERITY_META, SEVERITY_ORDER, healthMeta } from '../utils/severity'
import type { RunStreamMode } from '../hooks/useRunStream'

const STREAM_MODE_META: Record<RunStreamMode, { label: string; icon: typeof Wifi; className: string; dot: boolean }> = {
  idle: { label: 'Idle', icon: WifiOff, className: 'text-faint', dot: false },
  connecting: { label: 'Connecting', icon: Loader2, className: 'text-blue-500', dot: false },
  live: { label: 'Live', icon: Wifi, className: 'text-emerald-500', dot: true },
  reconnecting: { label: 'Reconnecting', icon: Loader2, className: 'text-amber-500', dot: false },
  polling: { label: 'Polling every 3s', icon: WifiOff, className: 'text-amber-500', dot: false },
  done: { label: 'Stream closed', icon: WifiOff, className: 'text-faint', dot: false },
}

function StreamIndicator({ mode }: { mode: RunStreamMode }) {
  const meta = STREAM_MODE_META[mode]
  const Icon = meta.icon
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center gap-1.5 text-xs font-medium', meta.className)}
    >
      {meta.dot ? (
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      ) : (
        <Icon
          size={13}
          className={cn((mode === 'connecting' || mode === 'reconnecting') && 'animate-spin')}
          aria-hidden="true"
        />
      )}
      {meta.label}
    </span>
  )
}

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()

  const runQuery = useRun(runId)
  const run = runQuery.data
  const isActive = run?.status === 'queued' || run?.status === 'running'

  const stream = useRunStream(runId, Boolean(isActive))

  // Polling fallback when the SSE stream cannot be re-established.
  useRun(runId, { refetchInterval: isActive && stream.mode === 'polling' ? 3_000 : false })

  const checksQuery = useRunChecks(runId)
  const findingsQuery = useRunFindings(runId, { page: 1, limit: 100 })
  const loadQuery = useRunLoadTest(runId)
  const previousFindingsQuery = useRunFindings(run?.previousRunId, { page: 1, limit: 100 })

  const cancelRun = useCancelRun(runId ?? '')
  const rerunRun = useRerunRun(runId ?? '')
  const report = useDownloadReport(runId ?? '')

  const checks = useMemo(
    () => mergeById(checksQuery.data?.items ?? [], stream.liveChecks),
    [checksQuery.data, stream.liveChecks],
  )
  const findings = useMemo(
    () => mergeById(findingsQuery.data?.items ?? [], stream.liveFindings),
    [findingsQuery.data, stream.liveFindings],
  )
  const stages = useMemo(
    () => mergeStages(run?.stages ?? [], stream.stageOverrides),
    [run?.stages, stream.stageOverrides],
  )

  const severityCounts = useMemo(() => {
    const counts = new Map(SEVERITY_ORDER.map((severity) => [severity, 0]))
    for (const finding of findings) counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1)
    return counts
  }, [findings])

  if (runQuery.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <SkeletonTable rows={6} columns={5} />
      </div>
    )
  }

  if (runQuery.isError || !run) {
    return (
      <ErrorState
        className="mt-12"
        title="We couldn’t load this run"
        message={getErrorMessage(runQuery.error)}
        onRetry={() => void runQuery.refetch()}
      />
    )
  }

  const health = healthMeta(run.healthScore)

  const handleCancel = async () => {
    try {
      await cancelRun.mutateAsync()
      toast.info('Run cancelled')
    } catch (error) {
      toast.error('Could not cancel the run', getErrorMessage(error))
    }
  }

  const handleRerun = async () => {
    try {
      const result = await rerunRun.mutateAsync({ loadUsers: run.loadUsers })
      toast.success('Rerun started', 'Findings will be compared against this run automatically.')
      navigate(`/runs/${result.runId}`)
    } catch (error) {
      toast.error('Could not start the rerun', getErrorMessage(error))
    }
  }

  const handleReport = async (format: 'json' | 'pdf') => {
    try {
      const blob = await report.mutateAsync(format)
      downloadBlob(blob, `proofloop-run-${run.id}.${format}`)
    } catch (error) {
      toast.error('Could not download the report', getErrorMessage(error))
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              to={`/projects/${run.projectId}`}
              className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
            >
              <ArrowLeft size={14} aria-hidden="true" />
              {run.projectName}
            </Link>
            <span aria-hidden="true" className="text-faint">/</span>
            <h1 className="font-mono text-lg font-semibold tracking-tight text-fg">{run.id}</h1>
            <RunStatusBadge status={run.status} />
            <Badge variant={run.trigger === 'rerun' ? 'accent' : 'muted'} className="capitalize">
              {run.trigger}
            </Badge>
            {isActive ? <StreamIndicator mode={stream.mode} /> : null}
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
            <span>Started {formatDateTime(run.startedAt)}</span>
            {run.durationMs != null ? <span>Duration {formatDuration(run.durationMs)}</span> : null}
            <span className="inline-flex items-center gap-1.5">
              <Activity size={12} aria-hidden="true" />
              Load budget {run.loadUsers} users
            </span>
            {run.commitSha ? (
              <Link
                to={`/projects/${run.projectId}/commits/${run.commitSha}`}
                className="inline-flex items-center gap-1.5 hover:text-accent"
              >
                <GitCommitHorizontal size={12} aria-hidden="true" />
                {run.commitSha.slice(0, 7)}
              </Link>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isActive ? (
            <Button
              variant="danger"
              icon={<Ban size={14} />}
              loading={cancelRun.isPending}
              onClick={() => void handleCancel()}
            >
              Cancel run
            </Button>
          ) : (
            <Button
              variant="outline"
              icon={<RotateCw size={14} />}
              loading={rerunRun.isPending}
              onClick={() => void handleRerun()}
            >
              Rerun
            </Button>
          )}
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              icon={<FileJson size={13} />}
              loading={report.isPending && report.variables === 'json'}
              onClick={() => void handleReport('json')}
            >
              JSON
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<FileText size={13} />}
              loading={report.isPending && report.variables === 'pdf'}
              onClick={() => void handleReport('pdf')}
            >
              PDF report
            </Button>
          </div>
        </div>
      </header>

      {/* Summary */}
      <section className="card card-pad">
        <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
          <div className="flex items-center justify-center">
            <Gauge
              value={run.healthScore}
              label={run.status === 'running' ? 'Verifying…' : health.label}
              size={132}
              strokeWidth={11}
            />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-faint">Checks</p>
                <p className="mt-1 flex items-center gap-3 text-sm">
                  <span className="inline-flex items-center gap-1.5 text-emerald-500">
                    <CheckCircle2 size={15} aria-hidden="true" />
                    {run.passedChecks} passed
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-red-500">
                    <XCircle size={15} aria-hidden="true" />
                    {run.failedChecks} failed
                  </span>
                  <span className="text-faint">/ {run.totalChecks}</span>
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-faint">Findings by severity</p>
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {SEVERITY_ORDER.map((severity) => {
                    const count = severityCounts.get(severity) ?? 0
                    const meta = SEVERITY_META[severity]
                    return (
                      <span
                        key={severity}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
                          count > 0 ? meta.badgeClass : 'border-border bg-raised text-faint',
                        )}
                      >
                        <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', count > 0 ? meta.dotClass : 'bg-faint')} />
                        {count} {meta.label}
                      </span>
                    )
                  })}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-faint">Risk budget</p>
                <p className="mt-1 text-sm text-muted">
                  p95 ≤ {loadQuery.data?.thresholdP95Ms ?? 800} ms · errors ≤{' '}
                  {formatPercent(loadQuery.data?.thresholdErrorRatePct ?? 5, 0)} ·{' '}
                  {formatRelativeTime(run.finishedAt ?? run.startedAt)}
                </p>
              </div>
            </div>

            {run.summary ? (
              <p className="mt-4 rounded-lg border bg-sunken px-4 py-3 text-sm leading-relaxed text-muted">
                {run.summary}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {/* Stages */}
      <section className="card card-pad">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-fg">Verification stages</h2>
          {isActive ? <StreamIndicator mode={stream.mode} /> : null}
        </div>
        <RunProgress stages={stages} />
      </section>

      {/* Checks */}
      <section className="card card-pad">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-fg">
            Checks <span className="ml-1 font-normal text-faint">({checks.length})</span>
          </h2>
        </div>
        {checksQuery.isError && checks.length === 0 ? (
          <ErrorState title="We couldn’t load checks" onRetry={() => void checksQuery.refetch()} />
        ) : (
          <CheckList runId={run.id} checks={checks} loading={checksQuery.isPending} />
        )}
      </section>

      {/* Load test */}
      <section className="card card-pad">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-fg">Load test — latency &amp; errors vs. users</h2>
          {loadQuery.data && loadQuery.data.routes.length > 0 ? (
            <span className="text-xs text-faint">generated {formatRelativeTime(loadQuery.data.generatedAt)}</span>
          ) : null}
        </div>
        {loadQuery.isError && !loadQuery.data ? (
          <ErrorState title="We couldn’t load the load-test results" onRetry={() => void loadQuery.refetch()} />
        ) : loadQuery.isPending ? (
          <Skeleton className="h-72 w-full" />
        ) : loadQuery.data ? (
          <LoadChart data={loadQuery.data} />
        ) : null}
      </section>

      {/* Comparison (reruns) */}
      {run.previousRunId ? (
        <section className="card card-pad">
          <div className="mb-4 flex items-center gap-2">
            <GitCompareArrows size={16} className="text-accent" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-fg">What changed since the previous run</h2>
          </div>
          {previousFindingsQuery.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : previousFindingsQuery.isError ? (
            <ErrorState
              title="We couldn’t load the previous run’s findings"
              onRetry={() => void previousFindingsQuery.refetch()}
            />
          ) : (
            <RunComparison
              current={findings}
              previous={previousFindingsQuery.data?.items ?? []}
              previousRunId={run.previousRunId}
            />
          )}
        </section>
      ) : null}

      {/* Findings */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            Findings
            <span className="font-normal text-faint">({findings.length})</span>
          </h2>
          {findings.length > 0 ? (
            <p className="text-xs text-faint">
              {pluralize(findings.length, 'finding')} · evidence attached to every one
            </p>
          ) : null}
        </div>
        {findingsQuery.isError && findings.length === 0 ? (
          <ErrorState title="We couldn’t load findings" onRetry={() => void findingsQuery.refetch()} />
        ) : (
          <FindingsList
            findings={findings}
            loading={findingsQuery.isPending || (isActive && findings.length === 0)}
            emptyTitle={isActive ? 'No findings so far' : 'Every check passed'}
            emptyDescription={
              isActive
                ? 'Findings appear here the moment a check fails — stay on this page, it’s live.'
                : 'Nothing to explain: the tests decided everything passed.'
            }
          />
        )}
      </section>

      {!isActive && run.status === 'cancelled' ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <PlayCircle size={15} className="text-faint" aria-hidden="true" />
          This run was cancelled — rerun to get a complete verification.
        </p>
      ) : null}

      <footer className="flex items-center gap-2 pt-2 text-xs text-faint">
        <Download size={12} aria-hidden="true" />
        Reports include every check, artifact reference and finding with its confidence.
      </footer>
    </div>
  )
}
