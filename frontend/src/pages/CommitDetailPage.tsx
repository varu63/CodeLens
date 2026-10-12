import { Link, useParams } from 'react-router-dom'
import {
  AlertOctagon,
  ArrowLeft,
  FlaskConical,
  GitCommitHorizontal,
  GitPullRequestArrow,
  ListChecks,
  Sparkles,
  Workflow,
} from 'lucide-react'
import { useCommit } from '../hooks/useProjects'
import { CommitRiskBadge } from '../components/commits/CommitRiskBadge'
import { Badge } from '../components/ui/Badge'
import { ErrorState } from '../components/ui/EmptyState'
import { Skeleton, SkeletonText } from '../components/ui/Skeleton'
import { cn, formatDateTime, pluralize } from '../utils/format'
import type { CommitChange } from '../types/domain.types'

const CHANGE_META: Record<CommitChange, { label: string; className: string }> = {
  added: { label: 'A', className: 'text-emerald-600 dark:text-emerald-400' },
  modified: { label: 'M', className: 'text-amber-600 dark:text-amber-400' },
  deleted: { label: 'D', className: 'text-red-600 dark:text-red-400' },
  renamed: { label: 'R', className: 'text-blue-600 dark:text-blue-400' },
}

export function CommitDetailPage() {
  const { projectId, sha } = useParams<{ projectId: string; sha: string }>()
  const commitQuery = useCommit(projectId, sha)

  if (commitQuery.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <SkeletonText lines={5} />
      </div>
    )
  }

  if (commitQuery.isError || !commitQuery.data) {
    return (
      <ErrorState
        className="mt-12"
        title="We couldn’t load this commit"
        onRetry={() => void commitQuery.refetch()}
      />
    )
  }

  const commit = commitQuery.data
  const risky = commit.risk.level !== 'low'

  return (
    <div className="space-y-6">
      {/* Header */}
      <header>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link
            to={`/projects/${projectId}`}
            className="inline-flex items-center gap-1.5 text-muted transition-colors hover:text-fg"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Back to project
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-lg border bg-raised px-3 py-1.5">
            <GitCommitHorizontal size={15} className="text-faint" aria-hidden="true" />
            <span className="font-mono text-sm font-semibold text-fg">{commit.shortSha}</span>
          </span>
          <CommitRiskBadge risk={commit.risk} />
          {commit.failingTests.length > 0 ? (
            <Badge variant="danger" dot>
              {pluralize(commit.failingTests.length, 'failing test')}
            </Badge>
          ) : (
            <Badge variant="success" dot>
              Tests green
            </Badge>
          )}
        </div>

        <h1 className="mt-3 max-w-3xl text-xl font-semibold leading-snug tracking-tight text-fg">
          {commit.message}
        </h1>
        <p className="mt-1.5 text-xs text-faint">
          {commit.author} · committed {formatDateTime(commit.committedAt)} ·{' '}
          <span className="text-emerald-500">+{commit.additions}</span>{' '}
          <span className="text-red-500">−{commit.deletions}</span> across{' '}
          {pluralize(commit.filesChanged.length, 'file')}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          {/* What changed */}
          <section className="card card-pad">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <Workflow size={15} className="text-faint" aria-hidden="true" />
              What changed
            </h2>
            <ul className="mt-3 divide-y rounded-xl border">
              {commit.filesChanged.map((file) => {
                const change = CHANGE_META[file.change]
                return (
                  <li key={file.path} className="flex items-center gap-3 px-3.5 py-2.5">
                    <span
                      className={cn('w-4 text-center font-mono text-xs font-bold', change.className)}
                      title={file.change}
                    >
                      {change.label}
                    </span>
                    <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg" title={file.path}>
                      {file.path}
                    </code>
                    <span className="whitespace-nowrap font-mono text-xs">
                      <span className="text-emerald-500">+{file.additions}</span>{' '}
                      <span className="text-red-500">−{file.deletions}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>

          {/* LLM description */}
          <section className="card card-pad">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
                <Sparkles size={15} className="text-accent" aria-hidden="true" />
                What this commit does
              </h2>
              <Badge variant="accent">AI-generated</Badge>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted">{commit.llmDescription}</p>
            <p className="mt-3 text-xs text-faint">
              Generated from the diff — the risk signals and test results below come from actual checks.
            </p>
          </section>

          {/* Failing tests */}
          <section className="card card-pad">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <FlaskConical size={15} className="text-faint" aria-hidden="true" />
              Failing tests
            </h2>
            {commit.failingTests.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {commit.failingTests.map((test) => (
                  <li
                    key={test}
                    className="flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 font-mono text-[13px] text-red-600 dark:text-red-400"
                  >
                    <AlertOctagon size={14} className="shrink-0" aria-hidden="true" />
                    {test}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">
                Every test in the affected suites passed on this commit.
              </p>
            )}
            {commit.testsAffected.length > 0 ? (
              <div className="mt-4 border-t pt-3">
                <p className="text-xs uppercase tracking-wide text-faint">Suites touched</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {commit.testsAffected.map((suite) => (
                    <span key={suite} className="rounded-full border bg-raised px-2 py-0.5 font-mono text-[11px] text-muted">
                      {suite}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {/* Risk reasons */}
          <section className={cn('card card-pad', risky && 'border-amber-500/30')}>
            <h2 className="text-sm font-semibold text-fg">Why this risk score</h2>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-fg">{commit.risk.score}</span>
              <span className="text-xs capitalize text-muted">{commit.risk.level} risk</span>
            </p>
            <ul className="mt-4 space-y-3">
              {commit.risk.signals.map((signal) => (
                <li key={signal.label} className="text-sm">
                  <p className="flex items-center justify-between gap-3 font-medium text-fg">
                    {signal.label}
                    {signal.weight != null ? (
                      <span className="font-mono text-[11px] text-faint">+{signal.weight}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{signal.description}</p>
                </li>
              ))}
              {commit.risk.signals.length === 0 ? (
                <li className="text-sm text-muted">No risk signals detected.</li>
              ) : null}
            </ul>
          </section>

          {/* Suggested action */}
          <section className="card card-pad">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <GitPullRequestArrow size={15} className="text-faint" aria-hidden="true" />
              Suggested action
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{commit.suggestedAction}</p>
          </section>

          {/* Verify link */}
          <section className="card card-pad text-xs">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
              <ListChecks size={15} className="text-faint" aria-hidden="true" />
              Prove it
            </h2>
            <p className="mt-2 leading-relaxed text-muted">
              Run verification on this project to confirm whether these changes introduce failures —
              the checks decide, not the score.
            </p>
            <Link
              to={`/projects/${projectId}?tab=runs`}
              className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg border px-3.5 text-sm font-medium text-fg transition-colors hover:bg-raised"
            >
              View run history
            </Link>
          </section>
        </aside>
      </div>
    </div>
  )
}
