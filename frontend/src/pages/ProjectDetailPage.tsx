import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Database,
  ExternalLink,
  GitBranch,
  Globe2,
  History,
  LayoutList,
  Network,
  Pencil,
  PlayCircle,
  Table2,
} from 'lucide-react'
import { useProject, useProjectCommits, useProjectRuns, useProjectStructure, useUpdateProject } from '../hooks/useProjects'
import { getErrorMessage } from '../api/client'
import { VerifyButton } from '../components/runs/VerifyButton'
import { CommitRiskBadge } from '../components/commits/CommitRiskBadge'
import { StructureMap } from '../components/projects/StructureMap'
import { Badge, RunStatusBadge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { EmptyState, ErrorState } from '../components/ui/EmptyState'
import { Gauge } from '../components/ui/Gauge'
import { Modal } from '../components/ui/Modal'
import { Skeleton, SkeletonCard, SkeletonTable } from '../components/ui/Skeleton'
import { Pagination, Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { toast } from '../components/ui/Toast'
import { cn, formatDuration, formatRelativeTime, pluralize, truncateMiddle } from '../utils/format'
import { healthMeta } from '../utils/severity'
import type { Commit, Run } from '../types/domain.types'

type TabKey = 'overview' | 'structure' | 'commits' | 'runs'

const TABS: { key: TabKey; label: string; icon: typeof LayoutList }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutList },
  { key: 'structure', label: 'Structure map', icon: Network },
  { key: 'commits', label: 'Commits', icon: History },
  { key: 'runs', label: 'Run history', icon: PlayCircle },
]

/* ------------------------------- Overview tab ------------------------------ */

function CommitsTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const commitsQuery = useProjectCommits(projectId, { page, limit: 10 })
  const items = commitsQuery.data?.items ?? []

  const columns: Column<Commit>[] = [
    {
      key: 'sha',
      header: 'Commit',
      render: (commit) => (
        <span className="font-mono text-[13px] text-accent">{commit.shortSha}</span>
      ),
    },
    {
      key: 'message',
      header: 'Message',
      render: (commit) => (
        <div className="min-w-0 max-w-md">
          <p className="truncate font-medium text-fg" title={commit.message}>
            {commit.message}
          </p>
          <p className="mt-0.5 truncate text-xs text-faint" title={commit.llmDescription}>
            {commit.llmDescription}
          </p>
          {commit.failingTests.length > 0 ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-red-500">
              <AlertTriangle size={12} aria-hidden="true" />
              {pluralize(commit.failingTests.length, 'failing test')}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'diff',
      header: '+ / −',
      className: 'hidden sm:table-cell',
      headerClassName: 'hidden sm:table-cell',
      render: (commit) => (
        <span className="whitespace-nowrap font-mono text-xs">
          <span className="text-emerald-500">+{commit.additions}</span>{' '}
          <span className="text-red-500">−{commit.deletions}</span>
        </span>
      ),
    },
    {
      key: 'author',
      header: 'Author',
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
      render: (commit) => <span className="text-sm text-muted">{commit.author}</span>,
    },
    {
      key: 'date',
      header: 'When',
      className: 'hidden sm:table-cell',
      headerClassName: 'hidden sm:table-cell',
      render: (commit) => (
        <span className="whitespace-nowrap text-xs text-faint">{formatRelativeTime(commit.committedAt)}</span>
      ),
    },
    {
      key: 'risk',
      header: 'Risk',
      align: 'right',
      render: (commit) => <CommitRiskBadge risk={commit.risk} />,
    },
  ]

  if (commitsQuery.isError) {
    return (
      <ErrorState
        title="We couldn’t load commits"
        onRetry={() => void commitsQuery.refetch()}
      />
    )
  }

  return (
    <div>
      <Table
        columns={columns}
        rows={items}
        rowKey={(commit) => commit.sha}
        loading={commitsQuery.isPending}
        onRowClick={(commit) => navigate(`/projects/${projectId}/commits/${commit.sha}`)}
        empty={
          <EmptyState
            icon={History}
            title="No commits yet"
            description="Once ProofLoop indexes your repository, commits and their risk signals appear here."
          />
        }
        caption="Commits"
      />
      <Pagination
        page={commitsQuery.data?.page ?? page}
        totalPages={commitsQuery.data?.totalPages ?? 1}
        total={commitsQuery.data?.total}
        onPageChange={setPage}
      />
    </div>
  )
}

function RunsTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const runsQuery = useProjectRuns(projectId, { page, limit: 10 })
  const items = runsQuery.data?.items ?? []

  const columns: Column<Run>[] = [
    {
      key: 'id',
      header: 'Run',
      render: (run) => <span className="font-mono text-[13px] text-accent">{run.id}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (run) => <RunStatusBadge status={run.status} />,
    },
    {
      key: 'checks',
      header: 'Checks',
      render: (run) => (
        <span className="whitespace-nowrap text-sm">
          <span className="text-emerald-500">{run.passedChecks} passed</span>
          {run.failedChecks > 0 ? (
            <>
              <span className="mx-1.5 text-faint">/</span>
              <span className="text-red-500">{run.failedChecks} failed</span>
            </>
          ) : null}
          <span className="ml-1.5 text-faint">({run.totalChecks})</span>
        </span>
      ),
    },
    {
      key: 'health',
      header: 'Health',
      className: 'hidden sm:table-cell',
      headerClassName: 'hidden sm:table-cell',
      render: (run) => (
        <span className={cn('font-semibold tabular-nums', healthMeta(run.healthScore).textClass)}>
          {run.healthScore ?? '—'}
        </span>
      ),
    },
    {
      key: 'trigger',
      header: 'Trigger',
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
      render: (run) => (
        <Badge variant={run.trigger === 'rerun' ? 'accent' : 'muted'} className="capitalize">
          {run.trigger}
        </Badge>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      className: 'hidden sm:table-cell',
      headerClassName: 'hidden sm:table-cell',
      render: (run) => <span className="text-xs text-muted">{formatDuration(run.durationMs)}</span>,
    },
    {
      key: 'started',
      header: 'Started',
      align: 'right',
      render: (run) => (
        <span className="whitespace-nowrap text-xs text-faint">{formatRelativeTime(run.startedAt)}</span>
      ),
    },
  ]

  if (runsQuery.isError) {
    return <ErrorState title="We couldn’t load run history" onRetry={() => void runsQuery.refetch()} />
  }

  return (
    <div>
      <Table
        columns={columns}
        rows={items}
        rowKey={(run) => run.id}
        loading={runsQuery.isPending}
        onRowClick={(run) => navigate(`/runs/${run.id}`)}
        empty={
          <EmptyState
            icon={PlayCircle}
            title="No runs yet"
            description="Click Verify to run the first full verification of this codebase."
          />
        }
        caption="Run history"
      />
      <Pagination
        page={runsQuery.data?.page ?? page}
        totalPages={runsQuery.data?.totalPages ?? 1}
        total={runsQuery.data?.total}
        onPageChange={setPage}
      />
    </div>
  )
}

/* ---------------------------------- Page ----------------------------------- */

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') as TabKey | null
  const tab: TabKey = tabParam && TABS.some((item) => item.key === tabParam) ? tabParam : 'overview'

  const projectQuery = useProject(projectId, {
    refetchInterval: (query) => {
      const latest = query.state.data?.latestRun
      return latest && (latest.status === 'running' || latest.status === 'queued') ? 4_000 : false
    },
  })
  const structureQuery = useProjectStructure(projectId)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  const updateProject = useUpdateProject()

  const setTab = (next: TabKey) => {
    setSearchParams(next === 'overview' ? {} : { tab: next }, { replace: true })
  }

  if (projectQuery.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <SkeletonTable />
      </div>
    )
  }

  if (projectQuery.isError || !projectQuery.data) {
    return (
      <ErrorState
        className="mt-12"
        title="We couldn’t load this project"
        message={getErrorMessage(projectQuery.error)}
        onRetry={() => void projectQuery.refetch()}
      />
    )
  }

  const project = projectQuery.data
  const run = project.latestRun
  const health = healthMeta(run?.healthScore)

  const openRename = () => {
    setRenameValue(project.name)
    setRenameError(null)
    setRenameOpen(true)
  }

  const submitRename = async () => {
    const name = renameValue.trim()
    if (name.length < 2) {
      setRenameError('Name must be at least 2 characters.')
      return
    }
    try {
      await updateProject.mutateAsync({ projectId: project.id, body: { name } })
      toast.success('Project renamed')
      setRenameOpen(false)
    } catch (err) {
      setRenameError(getErrorMessage(err))
    }
  }

  const stackEntries = [
    ['Language', project.stack.language],
    ['Framework', project.stack.framework],
    ['Runtime', project.stack.runtime],
    ['Database', project.stack.database],
    ['Package manager', project.stack.packageManager],
    ['Frontend', project.stack.frontend ?? '—'],
  ] as const

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-xl font-semibold tracking-tight text-fg">{project.name}</h1>
            <Badge variant="muted" className="uppercase">
              {project.source}
            </Badge>
            {run ? <RunStatusBadge status={run.status} /> : null}
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
            {project.gitUrl ? (
              <a
                href={project.gitUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 hover:text-accent"
              >
                <ExternalLink size={12} aria-hidden="true" />
                {truncateMiddle(project.gitUrl, 64)}
              </a>
            ) : (
              <span>Zip upload</span>
            )}
            {project.branch ? (
              <span className="inline-flex items-center gap-1">
                <GitBranch size={12} aria-hidden="true" />
                {project.branch}
              </span>
            ) : null}
            <span>Updated {formatRelativeTime(project.updatedAt)}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" icon={<Pencil size={14} />} onClick={openRename}>
            Rename
          </Button>
          <VerifyButton
            projectId={project.id}
            projectName={project.name}
            defaultLoadUsers={project.settings.defaultLoadUsers}
            label="Verify"
          />
        </div>
      </header>

      {/* Tabs */}
      <div role="tablist" aria-label="Project sections" className="flex flex-wrap gap-1.5 border-b pb-0">
        {TABS.map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              'flex items-center gap-2 rounded-t-lg border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
              tab === item.key
                ? 'border-accent text-fg'
                : 'border-transparent text-muted hover:bg-raised hover:text-fg',
            )}
          >
            <item.icon size={15} aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Stack */}
          <section className="card card-pad lg:col-span-2">
            <h2 className="text-sm font-semibold text-fg">Detected stack</h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {stackEntries.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs uppercase tracking-wide text-faint">{label}</dt>
                  <dd className="mt-1 text-sm font-medium text-fg">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5 border-t pt-4">
              <p className="text-xs uppercase tracking-wide text-faint">Test frameworks</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {project.stack.testFrameworks.map((framework) => (
                  <Badge key={framework} variant="info">
                    {framework}
                  </Badge>
                ))}
                {project.stack.testFrameworks.length === 0 ? (
                  <span className="text-sm text-muted">None detected</span>
                ) : null}
              </div>
            </div>
            <div className="mt-4">
              <p className="text-xs uppercase tracking-wide text-faint">Key dependencies</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {project.stack.dependencies.slice(0, 10).map((dependency) => (
                  <span key={dependency} className="rounded-full border bg-raised px-2 py-0.5 font-mono text-[11px] text-muted">
                    {dependency}
                  </span>
                ))}
                {project.stack.dependencies.length > 10 ? (
                  <span className="px-1 py-0.5 text-[11px] text-faint">
                    +{project.stack.dependencies.length - 10} more
                  </span>
                ) : null}
              </div>
            </div>
          </section>

          {/* Latest run */}
          <section className="card card-pad flex flex-col items-center justify-center text-center">
            <h2 className="self-start text-sm font-semibold text-fg">Latest run</h2>
            {run ? (
              <>
                <Gauge
                  className="mt-4"
                  value={run.healthScore}
                  label={health.label}
                  size={120}
                  strokeWidth={10}
                />
                <p className="mt-3 text-xs text-faint">
                  {run.status === 'running' ? 'Running now · ' : ''}
                  started {formatRelativeTime(run.startedAt)}
                </p>
                <Link
                  to={`/runs/${run.id}`}
                  className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium text-fg transition-colors hover:bg-raised"
                >
                  Open run <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </>
            ) : (
              <EmptyState
                className="mt-4 border-0 py-6"
                icon={PlayCircle}
                title="Not verified yet"
                description="Run the first verification to see the health score and findings."
              />
            )}
          </section>

          {/* Mapped surface */}
          <section className="card card-pad lg:col-span-3">
            <h2 className="text-sm font-semibold text-fg">Mapped codebase surface</h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                { label: 'Routes', value: project.routeCount, icon: Globe2, tab: 'structure' as TabKey },
                { label: 'Tables', value: project.tableCount, icon: Table2, tab: 'structure' as TabKey },
                { label: 'Components', value: project.componentCount, icon: Boxes, tab: 'structure' as TabKey },
                { label: 'API calls', value: project.apiCallCount, icon: Database, tab: 'structure' as TabKey },
              ].map((stat) => (
                <button
                  key={stat.label}
                  type="button"
                  onClick={() => setTab(stat.tab)}
                  className="flex items-center gap-3 rounded-xl border bg-surface px-4 py-3.5 text-left transition-colors hover:border-faint/70 hover:bg-raised/40"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent">
                    <stat.icon size={16} aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-lg font-semibold tabular-nums text-fg">{stat.value}</span>
                    <span className="block text-xs text-faint">{stat.label}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'structure' ? (
        structureQuery.isPending ? (
          <SkeletonTable rows={6} columns={3} />
        ) : structureQuery.isError || !structureQuery.data ? (
          <ErrorState
            title="We couldn’t load the structure map"
            message={getErrorMessage(structureQuery.error)}
            onRetry={() => void structureQuery.refetch()}
          />
        ) : (
          <StructureMap data={structureQuery.data} />
        )
      ) : null}

      {tab === 'commits' && projectId ? <CommitsTab projectId={projectId} /> : null}
      {tab === 'runs' && projectId ? <RunsTab projectId={projectId} /> : null}

      {/* Rename modal */}
      <Modal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        locked={updateProject.isPending}
        title="Rename project"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setRenameOpen(false)} disabled={updateProject.isPending}>
              Cancel
            </Button>
            <Button variant="primary" loading={updateProject.isPending} onClick={() => void submitRename()}>
              Save
            </Button>
          </>
        }
      >
        <label htmlFor="rename-project" className="label">
          Project name
        </label>
        <input
          id="rename-project"
          className="input mt-1.5"
          value={renameValue}
          onChange={(event) => setRenameValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submitRename()
          }}
        />
        {renameError ? <p className="mt-1.5 text-xs text-red-500">{renameError}</p> : null}
      </Modal>
    </div>
  )
}
