import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  CloudUpload,
  FileArchive,
  FolderGit2,
  FolderPlus,
  GitBranch,
  Search,
  Trash2,
} from 'lucide-react'
import { useCreateProject, useDeleteProject, useProjects, useUploadProject } from '../hooks/useProjects'
import { getErrorMessage } from '../api/client'
import { Button } from '../components/ui/Button'
import { RunStatusBadge } from '../components/ui/Badge'
import { EmptyState, ErrorState } from '../components/ui/EmptyState'
import { Modal } from '../components/ui/Modal'
import { Pagination, Table } from '../components/ui/Table'
import type { Column } from '../components/ui/Table'
import { toast } from '../components/ui/Toast'
import { cn, formatRelativeTime, truncateMiddle } from '../utils/format'
import type { Project } from '../types/domain.types'

const PAGE_SIZE = 9

/* ------------------------------- Create forms ------------------------------ */

const gitSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(80, 'Name is too long'),
  gitUrl: z
    .string()
    .min(1, 'Repository URL is required')
    .regex(/^(https?:\/\/|git@|ssh:\/\/)/, 'Use an https:// or git@ URL'),
  branch: z.string().max(120, 'Branch name is too long').optional(),
})

const zipSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(80, 'Name is too long'),
  file: z.custom<FileList>(
    (value) =>
      typeof FileList !== 'undefined' &&
      value instanceof FileList &&
      value.length === 1 &&
      /\.zip$/i.test(value[0].name),
    'Choose a .zip archive of your codebase',
  ),
})

type GitValues = z.infer<typeof gitSchema>
type ZipValues = z.infer<typeof zipSchema>

function CreateProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'git' | 'zip'>('git')
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const createProject = useCreateProject()
  const uploadProject = useUploadProject()

  const gitForm = useForm<GitValues>({
    resolver: zodResolver(gitSchema),
    defaultValues: { name: '', gitUrl: '', branch: '' },
  })
  const zipForm = useForm<ZipValues>({ resolver: zodResolver(zipSchema) })

  useEffect(() => {
    if (open) {
      setError(null)
      setProgress(null)
      gitForm.reset()
      zipForm.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const busy = createProject.isPending || uploadProject.isPending

  const submitGit = gitForm.handleSubmit(async (values) => {
    setError(null)
    try {
      const project = await createProject.mutateAsync({
        name: values.name.trim(),
        gitUrl: values.gitUrl.trim(),
        branch: values.branch?.trim() || undefined,
      })
      toast.success('Project created', 'Connect succeeded — run your first verification.')
      onClose()
      navigate(`/projects/${project.id}`)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  })

  const submitZip = zipForm.handleSubmit(async (values) => {
    setError(null)
    try {
      const project = await createProject.mutateAsync({ name: values.name.trim() })
      setProgress(0)
      const result = await uploadProject.mutateAsync({
        projectId: project.id,
        file: values.file[0],
        onProgress: (percent) => setProgress(percent),
      })
      toast.success(
        'Upload complete',
        `${result.filesDetected} files detected in ${values.file[0].name}.`,
      )
      onClose()
      navigate(`/projects/${project.id}`)
    } catch (err) {
      setError(getErrorMessage(err))
      setProgress(null)
    }
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={busy}
      title="Connect a codebase"
      description="ProofLoop reads your code, detects the stack, then verifies it with real checks."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => void (tab === 'git' ? submitGit() : submitZip())}
          >
            {tab === 'git' ? 'Connect repository' : progress != null ? `Uploading ${progress}%` : 'Create & upload'}
          </Button>
        </>
      }
    >
      <div role="tablist" aria-label="Source type" className="mb-5 grid grid-cols-2 gap-1 rounded-lg border bg-sunken p-1">
        {(
          [
            { key: 'git', label: 'Git repository', icon: FolderGit2 },
            { key: 'zip', label: 'Zip upload', icon: FileArchive },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            type="button"
            disabled={busy}
            onClick={() => {
              setTab(item.key)
              setError(null)
            }}
            className={cn(
              'flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              tab === item.key ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
            )}
          >
            <item.icon size={15} aria-hidden="true" />
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'git' ? (
        <form onSubmit={submitGit} noValidate className="space-y-4">
          <div>
            <label htmlFor="project-name" className="label">
              Project name
            </label>
            <input
              id="project-name"
              className="input mt-1.5"
              placeholder="booking-api"
              aria-invalid={Boolean(gitForm.formState.errors.name)}
              {...gitForm.register('name')}
            />
            {gitForm.formState.errors.name ? (
              <p className="mt-1.5 text-xs text-red-500">{gitForm.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="project-git-url" className="label">
              Repository URL
            </label>
            <input
              id="project-git-url"
              className="input mt-1.5 font-mono text-[13px]"
              placeholder="https://github.com/acme/booking-api"
              aria-invalid={Boolean(gitForm.formState.errors.gitUrl)}
              {...gitForm.register('gitUrl')}
            />
            {gitForm.formState.errors.gitUrl ? (
              <p className="mt-1.5 text-xs text-red-500">{gitForm.formState.errors.gitUrl.message}</p>
            ) : null}
          </div>
          <div>
            <label htmlFor="project-branch" className="label">
              Branch <span className="font-normal text-faint">(optional, defaults to main)</span>
            </label>
            <div className="relative mt-1.5">
              <GitBranch size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
              <input
                id="project-branch"
                className="input w-full pl-9 font-mono text-[13px]"
                placeholder="main"
                {...gitForm.register('branch')}
              />
            </div>
          </div>
        </form>
      ) : (
        <form onSubmit={submitZip} noValidate className="space-y-4">
          <div>
            <label htmlFor="zip-project-name" className="label">
              Project name
            </label>
            <input
              id="zip-project-name"
              className="input mt-1.5"
              placeholder="booking-api"
              aria-invalid={Boolean(zipForm.formState.errors.name)}
              {...zipForm.register('name')}
            />
            {zipForm.formState.errors.name ? (
              <p className="mt-1.5 text-xs text-red-500">{zipForm.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div>
            <span className="label">Codebase archive (.zip)</span>
            <label
              htmlFor="zip-project-file"
              className={cn(
                'mt-1.5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center transition-colors hover:border-accent/50 hover:bg-raised/50',
                zipForm.formState.errors.file && 'border-red-500/50',
              )}
            >
              <CloudUpload size={22} className="text-faint" aria-hidden="true" />
              {zipForm.watch('file')?.[0] ? (
                <>
                  <span className="text-sm font-medium text-fg">{zipForm.watch('file')[0].name}</span>
                  <span className="text-xs text-faint">
                    {(zipForm.watch('file')[0].size / (1024 * 1024)).toFixed(1)} MB
                  </span>
                </>
              ) : (
                <>
                  <span className="text-sm text-fg">Click to choose a .zip file</span>
                  <span className="text-xs text-faint">Excludes node_modules automatically</span>
                </>
              )}
              <input id="zip-project-file" type="file" accept=".zip,application/zip" className="sr-only" {...zipForm.register('file')} />
            </label>
            {zipForm.formState.errors.file ? (
              <p className="mt-1.5 text-xs text-red-500">{zipForm.formState.errors.file.message}</p>
            ) : null}
          </div>
          {progress != null ? (
            <div>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Uploading archive…</span>
                <span className="tabular-nums">{progress}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : null}
        </form>
      )}

      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </p>
      ) : null}
    </Modal>
  )
}

/* ---------------------------------- Page ----------------------------------- */

export function ProjectsPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query])

  const params = useMemo(
    () => ({ page, limit: PAGE_SIZE, query: debouncedQuery || undefined }),
    [page, debouncedQuery],
  )
  const projectsQuery = useProjects(params)
  const deleteProject = useDeleteProject()

  const items = projectsQuery.data?.items ?? []

  const confirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await deleteProject.mutateAsync(pendingDelete.id)
      toast.success('Project deleted', `“${pendingDelete.name}” and its runs were removed.`)
      setPendingDelete(null)
    } catch (err) {
      toast.error('Could not delete project', getErrorMessage(err))
    }
  }

  const columns: Column<Project>[] = [
    {
      key: 'name',
      header: 'Project',
      render: (project) => (
        <div className="min-w-0">
          <Link
            to={`/projects/${project.id}`}
            className="block truncate font-medium text-fg hover:text-accent"
            onClick={(event) => event.stopPropagation()}
          >
            {project.name}
          </Link>
          <p className="mt-0.5 truncate font-mono text-xs text-faint" title={project.gitUrl ?? project.source}>
            {project.gitUrl ? truncateMiddle(project.gitUrl, 56) : `${project.source} upload`}
            {project.branch ? ` · ${project.branch}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'stack',
      header: 'Stack',
      render: (project) => (
        <span className="text-sm text-muted">
          {project.stack.language} · {project.stack.framework}
        </span>
      ),
    },
    {
      key: 'counts',
      header: 'Mapped',
      className: 'hidden md:table-cell',
      headerClassName: 'hidden md:table-cell',
      render: (project) => (
        <span className="whitespace-nowrap text-xs text-faint">
          {project.routeCount} routes · {project.tableCount} tables · {project.componentCount} comps
        </span>
      ),
    },
    {
      key: 'latestRun',
      header: 'Latest run',
      render: (project) =>
        project.latestRun ? (
          <span className="flex items-center gap-2">
            <RunStatusBadge status={project.latestRun.status} />
            <span className="text-xs text-faint">{formatRelativeTime(project.latestRun.startedAt)}</span>
          </span>
        ) : (
          <span className="text-xs text-faint">Never verified</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (project) => (
        <button
          type="button"
          aria-label={`Delete ${project.name}`}
          className="rounded-lg p-2 text-faint transition-colors hover:bg-red-500/10 hover:text-red-500"
          onClick={(event) => {
            event.stopPropagation()
            setPendingDelete(project)
          }}
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-fg">Projects</h1>
          <p className="mt-1 text-sm text-muted">
            {projectsQuery.data ? `${projectsQuery.data.total} connected codebases` : 'Connected codebases'}
          </p>
        </div>
        <Button variant="primary" icon={<FolderPlus size={15} />} onClick={() => setCreateOpen(true)}>
          New project
        </Button>
      </header>

      <div className="relative max-w-sm">
        <Search aria-hidden="true" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search projects…"
          aria-label="Search projects"
          className="input w-full pl-9"
        />
      </div>

      {projectsQuery.isError ? (
        <ErrorState
          title="We couldn’t load your projects"
          message="The API did not respond. Check your connection and try again."
          onRetry={() => void projectsQuery.refetch()}
        />
      ) : (
        <>
          <Table
            columns={columns}
            rows={items}
            rowKey={(project) => project.id}
            loading={projectsQuery.isPending}
            onRowClick={(project) => navigate(`/projects/${project.id}`)}
            empty={
              <EmptyState
                icon={FolderGit2}
                title={debouncedQuery ? 'No projects match your search' : 'No projects yet'}
                description={
                  debouncedQuery
                    ? `Nothing matches “${debouncedQuery}”. Try a different term.`
                    : 'Connect a Git repository or upload a zip of your codebase to get started.'
                }
                action={
                  debouncedQuery ? (
                    <Button variant="outline" onClick={() => setQuery('')}>
                      Clear search
                    </Button>
                  ) : (
                    <Button variant="primary" icon={<FolderPlus size={15} />} onClick={() => setCreateOpen(true)}>
                      Connect a project
                    </Button>
                  )
                }
              />
            }
            caption="Your projects"
          />
          <Pagination
            page={projectsQuery.data?.page ?? page}
            totalPages={projectsQuery.data?.totalPages ?? 1}
            total={projectsQuery.data?.total}
            onPageChange={setPage}
          />
        </>
      )}

      <CreateProjectModal open={createOpen} onClose={() => setCreateOpen(false)} />

      <Modal
        open={pendingDelete != null}
        onClose={() => setPendingDelete(null)}
        locked={deleteProject.isPending}
        title="Delete project?"
        description={`“${pendingDelete?.name}” and all of its runs, findings and commits will be permanently removed.`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleteProject.isPending}>
              Keep project
            </Button>
            <Button variant="danger" loading={deleteProject.isPending} onClick={() => void confirmDelete()}>
              Delete permanently
            </Button>
          </>
        }
      />
    </div>
  )
}
