import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Boxes,
  ExternalLink,
  FolderGit2,
  FolderPlus,
  GitBranch,
  Globe2,
  Table2,
  Upload,
} from 'lucide-react'
import { useProjects } from '../hooks/useProjects'
import { useAuthStore } from '../store/authStore'
import { VerifyButton } from '../components/runs/VerifyButton'
import { RunStatusBadge } from '../components/ui/Badge'
import { EmptyState, ErrorState } from '../components/ui/EmptyState'
import { SkeletonCard } from '../components/ui/Skeleton'
import { cn, formatRelativeTime } from '../utils/format'
import { healthMeta } from '../utils/severity'
import type { Project } from '../types/domain.types'

const SOURCE_META = {
  git: { label: 'Git', icon: FolderGit2 },
  zip: { label: 'Zip', icon: Upload },
  cli: { label: 'CLI', icon: Globe2 },
} as const

function ProjectCard({ project }: { project: Project }) {
  const source = SOURCE_META[project.source]
  const SourceIcon = source.icon
  const run = project.latestRun
  const health = run?.healthScore ?? null
  const healthUi = healthMeta(health)

  return (
    <div className="card card-pad flex flex-col gap-4 transition-colors hover:border-faint/70">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/projects/${project.id}`}
            className="block truncate text-sm font-semibold text-fg hover:text-accent"
          >
            {project.name}
          </Link>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-faint">
            <SourceIcon size={12} aria-hidden="true" />
            {source.label}
            {project.branch ? (
              <>
                <span aria-hidden="true">·</span>
                <GitBranch size={12} aria-hidden="true" />
                {project.branch}
              </>
            ) : null}
          </p>
        </div>
        {run ? <RunStatusBadge status={run.status} /> : null}
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs text-muted">
        <span className="rounded-full border bg-raised px-2 py-0.5">{project.stack.language}</span>
        <span className="rounded-full border bg-raised px-2 py-0.5">{project.stack.framework}</span>
        <span className="rounded-full border bg-raised px-2 py-0.5">{project.stack.database}</span>
      </div>

      <div className="flex items-center gap-4 text-xs text-faint">
        <span className="flex items-center gap-1.5" title="Detected routes">
          <Globe2 size={13} aria-hidden="true" /> {project.routeCount}
        </span>
        <span className="flex items-center gap-1.5" title="Detected tables">
          <Table2 size={13} aria-hidden="true" /> {project.tableCount}
        </span>
        <span className="flex items-center gap-1.5" title="Detected components">
          <Boxes size={13} aria-hidden="true" /> {project.componentCount}
        </span>
        <span className="ml-auto">{formatRelativeTime(project.updatedAt)}</span>
      </div>

      <div className="flex items-center justify-between border-t pt-4">
        {run ? (
          <div className="flex items-center gap-2">
            <span className={cn('text-lg font-semibold tabular-nums', healthUi.textClass)}>
              {health ?? '—'}
            </span>
            <span className="text-xs text-faint">
              health
              <br />
              {formatRelativeTime(run.startedAt)}
            </span>
          </div>
        ) : (
          <span className="text-xs text-faint">No runs yet</span>
        )}
        <div className="flex items-center gap-2">
          {run ? (
            <Link
              to={`/runs/${run.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-raised hover:text-fg"
            >
              Last run <ArrowRight size={13} aria-hidden="true" />
            </Link>
          ) : null}
          <VerifyButton
            projectId={project.id}
            projectName={project.name}
            defaultLoadUsers={project.settings.defaultLoadUsers}
            size="sm"
            label="Verify"
          />
        </div>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const user = useAuthStore((state) => state.user)
  const projectsQuery = useProjects({ page: 1, limit: 12 })
  const projects = projectsQuery.data?.items ?? []

  const firstName = user?.name?.split(' ')[0]

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">
            {firstName ? `Welcome back, ${firstName}` : 'Dashboard'}
          </h1>
          <p className="mt-1 text-sm text-muted">
            Verify a codebase and prove it works before your users find out.
          </p>
        </div>
        <Link
          to="/projects"
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent-hover dark:text-bg"
        >
          <FolderPlus size={15} aria-hidden="true" />
          New project
        </Link>
      </header>

      {projectsQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      ) : projectsQuery.isError ? (
        <ErrorState
          title="We couldn’t load your projects"
          message="The API did not respond. Check your connection and try again."
          onRetry={() => void projectsQuery.refetch()}
        />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No projects yet"
          description="Connect a Git repository or upload a zip of your codebase to run your first verification."
          className="mt-10"
          action={
            <Link
              to="/projects"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover dark:text-bg"
            >
              <FolderPlus size={15} aria-hidden="true" />
              Connect a project
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
          {(projectsQuery.data?.total ?? 0) > projects.length ? (
            <div className="flex justify-center pt-2">
              <Link
                to="/projects"
                className="inline-flex h-9 items-center gap-2 rounded-lg border px-3.5 text-sm font-medium text-fg transition-colors hover:bg-raised"
              >
                View all {projectsQuery.data?.total} projects
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </div>
          ) : null}
        </>
      )}

      <p className="pt-2 text-center text-xs text-faint">
        <ExternalLink size={12} className="mr-1 inline" aria-hidden="true" />
        Tests decide PASS / FAIL — AI only explains. Every finding links to its evidence.
      </p>
    </div>
  )
}
