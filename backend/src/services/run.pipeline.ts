import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { env } from '../config/env.js'
import type { ArtifactRow } from '../db/queries/artifacts.queries.js'
import { checkStatsForRun, listChecksForRun, updateCheck } from '../db/queries/checks.queries.js'
import type { CheckRow, CheckStatusRow, CheckTypeRow } from '../db/queries/checks.queries.js'
import { severityCountsForRun } from '../db/queries/findings.queries.js'
import type { SeverityRow } from '../db/queries/findings.queries.js'
import { insertLoadResult, listLoadResultsForRun } from '../db/queries/loadResults.queries.js'
import { findProjectById } from '../db/queries/projects.queries.js'
import type { ProjectRow } from '../db/queries/projects.queries.js'
import { findRunById, updateRun } from '../db/queries/runs.queries.js'
import type { RunRow } from '../db/queries/runs.queries.js'
import { listRunStages, updateRunStage, RUN_STAGE_ORDER } from '../db/queries/runStages.queries.js'
import type { RunStageKey, RunStageRow } from '../db/queries/runStages.queries.js'
import {
  EMPTY_STRUCTURE,
  findStructure,
  updateApiCallStatus,
  updateRouteIssues,
  upsertStructure,
} from '../db/queries/structures.queries.js'
import type { StructureMapData } from '../db/queries/structures.queries.js'
import { toApiCheck, toApiLoadTestResult, toApiRun, toApiStages } from '../utils/mappers.js'
import { logger } from '../utils/logger.js'
import type { RunStreamEvent } from '../types/stream.types.js'
import { runEvents } from './sse.service.js'
import { scanWorkspace } from './scan.service.js'
import { saveLogArtifact } from './artifacts.service.js'
import { analyzeProjectCommits } from './commit.service.js'
import { createFindings } from './findings.service.js'
import type { FindingInput } from './findings.service.js'
import { runDatabaseCheck } from './databaseCheck.service.js'
import { runGitleaks, runNpmAudit, runSemgrep } from './securityChecks.service.js'
import { isDockerAvailable, runInSandbox } from './sandbox.service.js'
import type { SandboxResult } from './sandbox.service.js'
import { workspaceDir } from './workspace.service.js'

export interface StageSpec {
  stage: RunStageKey
  type: CheckTypeRow
  name: string
  command?: string
}

/** One check row per pipeline stage; sort_order follows RUN_STAGE_ORDER. */
export const STAGE_SPECS: StageSpec[] = [
  { stage: 'structure', type: 'structure', name: 'Structure scan' },
  { stage: 'existing_tests', type: 'existing_tests', name: 'Existing test suite' },
  { stage: 'api_tests', type: 'api', name: 'API contract tests' },
  { stage: 'data_fetch', type: 'data_fetch', name: 'Data fetch validation' },
  { stage: 'mapping', type: 'data_mapping', name: 'Data mapping validation' },
  { stage: 'database', type: 'db', name: 'Database checks' },
  { stage: 'load', type: 'load', name: 'Load test' },
  { stage: 'security', type: 'security', name: 'Security baseline' },
]

export interface StageResult {
  status: Extract<CheckStatusRow, 'passed' | 'failed' | 'skipped'>
  message: string
  exitCode?: number | null
  durationMs?: number
  artifacts?: ArtifactRow[]
}

interface StageContext {
  run: RunRow
  project: ProjectRow
  projectId: string
  runId: string
  workspace: string
  structure: StructureMapData
  /** Pre-created check row per stage type, keyed by check type. */
  checks: Map<CheckTypeRow, CheckRow>
  /** Dependency install shared by test stages; resolved once per run. */
  depsReady: Promise<{ ok: boolean; note: string }> | null
}

/** Stage handlers receive the shared context plus their own check row id. */
type StageHandler = (ctx: StageContext, checkId: string) => Promise<StageResult>

const MAX_FINDINGS_PER_CHECK = 10
const MAX_SECURITY_FINDINGS = 15
/** Port the app under test listens on inside the sandbox. */
const SANDBOX_PORT = 3000

/* ------------------------------- Event emit -------------------------------- */

function toStreamStage(row: RunStageRow): {
  stage: string
  status: 'queued' | 'running' | 'passed' | 'failed' | 'skipped'
  startedAt?: string
  finishedAt?: string
  message?: string
} {
  const status = row.status === 'error' ? 'failed' : row.status
  return {
    stage: row.stage,
    status,
    ...(row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
    ...(row.finishedAt ? { finishedAt: row.finishedAt.toISOString() } : {}),
    ...(row.message ? { message: row.message } : {}),
  }
}

function publishProgress(runId: string, stages: RunStageRow[]): void {
  const done = stages.filter((stage) =>
    ['passed', 'failed', 'skipped', 'error'].includes(stage.status),
  ).length
  const percent = Math.round((done / Math.max(1, RUN_STAGE_ORDER.length)) * 100)
  runEvents.publish(runId, { type: 'progress', data: { percent } })
}

async function publishCheck(runId: string, check: CheckRow): Promise<void> {
  runEvents.publish(runId, { type: 'check', data: toApiCheck(check) })
}

/* ------------------------------ Helpers ------------------------------------ */

function combinedLog(result: SandboxResult): string {
  return [
    result.stdout && `--- stdout ---\n${result.stdout}`,
    result.stderr && `--- stderr ---\n${result.stderr}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

function readPackageJson(workspace: string): Record<string, unknown> | null {
  const packageJsonPath = path.join(workspace, 'package.json')
  if (!existsSync(packageJsonPath)) return null
  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function startCommandFor(workspace: string): string | null {
  const pkg = readPackageJson(workspace)
  if (!pkg) return null
  const scripts = (pkg.scripts ?? {}) as Record<string, string>
  if (scripts.start) return 'npm start --silent'
  if (scripts.dev) return 'npm run dev --silent'
  return null
}

interface AuthPlan {
  register: { method: string; path: string } | null
  login: { method: string; path: string } | null
}

/** Auth endpoints are discovered from the scanned structure (runners log in with them). */
function detectAuthPlan(routes: StructureMapData['routes']): AuthPlan | null {
  const registerRoute = routes.find(
    (route) => route.method === 'POST' && /register|signup|sign-up/i.test(route.path),
  )
  const loginRoute = routes.find(
    (route) => route.method === 'POST' && /login|signin|sign-in|token/i.test(route.path),
  )
  if (!registerRoute && !loginRoute) return null
  return {
    register: registerRoute ? { method: registerRoute.method, path: registerRoute.path } : null,
    login: loginRoute ? { method: loginRoute.method, path: loginRoute.path } : null,
  }
}

async function prepareDependencies(ctx: StageContext): Promise<{ ok: boolean; note: string }> {
  if (ctx.depsReady) return ctx.depsReady
  ctx.depsReady = (async () => {
    const packageJsonPath = path.join(ctx.workspace, 'package.json')
    if (!existsSync(packageJsonPath)) return { ok: true, note: 'no package.json — nothing to install' }
    if (existsSync(path.join(ctx.workspace, 'node_modules'))) {
      return { ok: true, note: 'node_modules already present' }
    }

    let hasDeps = false
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      hasDeps =
        Object.keys(pkg.dependencies ?? {}).length > 0 ||
        Object.keys(pkg.devDependencies ?? {}).length > 0
    } catch {
      return { ok: false, note: 'package.json is not valid JSON' }
    }
    if (!hasDeps) return { ok: true, note: 'no dependencies declared' }

    if (!(await isDockerAvailable())) return { ok: false, note: 'Docker is unavailable' }

    const result = await runInSandbox({
      workspaceDir: ctx.workspace,
      command:
        'if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi',
      network: 'bridge', // dependency installation is the one network-enabled step
      timeoutSec: Math.max(480, env.SANDBOX_TIMEOUT_SEC),
    })
    if (!result.ran) return { ok: false, note: result.error ?? 'sandbox unavailable' }
    if (result.timedOut) return { ok: false, note: 'dependency installation timed out' }
    if (result.exitCode !== 0) {
      return { ok: false, note: `dependency installation exited with code ${result.exitCode}` }
    }
    return { ok: true, note: 'dependencies installed' }
  })()
  return ctx.depsReady
}

interface RunnerInvocation {
  ran: boolean
  timedOut: boolean
  exitCode: number | null
  durationMs: number
  error?: string
  consoleLog: string
  scratchDir: string
  outDir: string
}

/**
 * Boots a sandbox runner script with its plan file and a read-write output dir.
 * The runner script and plan arrive on separate read-only mounts, so a check
 * can never alter worker-written inputs; only `/proofloop/out` is writable.
 */
async function invokeRunner(
  ctx: StageContext,
  options: { dirName: string; runnerFile: string; plan: unknown; timeoutSec?: number },
): Promise<RunnerInvocation> {
  const scratchDir = path.resolve('storage', 'runs', ctx.runId, options.dirName)
  const outDir = path.join(scratchDir, 'out')
  await mkdir(outDir, { recursive: true })
  await writeFile(path.join(scratchDir, 'plan.json'), JSON.stringify(options.plan, null, 2), 'utf8')

  const runnerScript = path.resolve('sandbox', 'runner', options.runnerFile)
  const result = await runInSandbox({
    workspaceDir: ctx.workspace,
    command: `node /proofloop/${options.runnerFile}`,
    network: 'none',
    ...(options.timeoutSec !== undefined ? { timeoutSec: options.timeoutSec } : {}),
    extraMounts: [
      {
        hostPath: path.join(scratchDir, 'plan.json'),
        containerPath: '/proofloop/plan.json',
        readOnly: true,
      },
      { hostPath: outDir, containerPath: '/proofloop/out' },
      { hostPath: runnerScript, containerPath: `/proofloop/${options.runnerFile}`, readOnly: true },
    ],
  })

  return {
    ran: result.ran,
    timedOut: result.timedOut,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    ...(result.error ? { error: result.error } : {}),
    consoleLog: combinedLog(result),
    scratchDir,
    outDir,
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `/api/items/:id` → matches `/api/items/42` (exact segment equality otherwise). */
function routePatternToRegex(routePath: string): RegExp {
  const segments = routePath
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment.startsWith(':') || segment === '*' ? '[^/]*' : escapeRegex(segment)))
  return new RegExp(`^/${segments.join('/')}/?$`)
}

function matchRoute(
  method: string,
  callPath: string,
  routes: StructureMapData['routes'],
): StructureMapData['routes'][number] | null {
  const cleanPath = (callPath.split('?')[0] ?? callPath).replace(/\/$/, '') || '/'
  for (const route of routes) {
    if (route.method.toUpperCase() !== method.toUpperCase()) continue
    if (routePatternToRegex(route.path).test(cleanPath)) return route
  }
  return null
}

function thresholdsFor(project: ProjectRow): { errorRatePct: number; p95Ms: number } {
  return {
    errorRatePct: project.settings.thresholds?.errorRatePct ?? 1,
    p95Ms: project.settings.thresholds?.p95Ms ?? 1000,
  }
}

/* ----------------------------- Runner wire types ---------------------------- */

interface ApiTestEntry {
  test: string
  method: string
  path: string
  expected: unknown
  actual?: number
  ok: boolean
  note?: string
}

interface ApiTestsOutput {
  serverStarted: boolean
  authTokenObtained: boolean
  authNote?: string
  startLogTail?: string
  results: ApiTestEntry[]
}

interface DataFetchEntry {
  method: string
  path: string
  needsAuth?: boolean
  httpStatus: number | null
  responseExcerpt?: string
  error?: string
}

interface DataFetchOutput {
  serverStarted: boolean
  authTokenObtained?: boolean
  startLogTail?: string
  results: DataFetchEntry[]
}

interface SecurityProbeEntry {
  method: string
  path: string
  auth: string
  httpStatus: number | null
  denied: boolean
  responseExcerpt?: string
  error?: string
}

interface SecurityProbeOutput {
  serverStarted: boolean
  startLogTail?: string
  results: SecurityProbeEntry[]
}

interface LoadLevelRaw {
  users: number
  avgMs?: number | null
  p50Ms?: number | null
  p95Ms?: number | null
  p99Ms?: number | null
  errorRatePct?: number
  requestsPerSecond?: number
  non2xx?: number
  errors?: number
  timeouts?: number
  totalRequests?: number
  error?: string
}

interface LoadRouteRaw {
  route: string
  method: string
  levels: LoadLevelRaw[]
  note?: string
}

interface LoadTestOutput {
  serverStarted: boolean
  autocannonAvailable: boolean
  authTokenObtained?: boolean
  durationSec?: number
  startLogTail?: string
  results: LoadRouteRaw[]
}

/* ----------------------------- Stage handlers ------------------------------ */

const stageHandlers: Record<RunStageKey, StageHandler> = {
  structure: async (ctx, checkId) => {
    if (!existsSync(ctx.workspace)) {
      return { status: 'failed', message: 'Project workspace not found on disk' }
    }
    const { structure } = await scanWorkspace(ctx.workspace)
    await upsertStructure(ctx.projectId, structure)
    ctx.structure = structure

    // Commit history analysis rides along with the scan: read-only, never
    // fails the stage, and only reports when the workspace is a git repo.
    const artifacts: ArtifactRow[] = []
    let commitNote = ''
    const analysis = await analyzeProjectCommits(ctx.workspace, ctx.projectId)
    if (analysis.git) {
      artifacts.push(
        await saveLogArtifact(
          ctx.runId,
          checkId,
          'commit-analysis.json',
          JSON.stringify(analysis, null, 2),
          'report',
        ),
      )
      commitNote = analysis.note ? `, commit history: ${analysis.note}` : `, ${analysis.analyzed} commit(s) analysed`
    }

    return {
      status: 'passed',
      message: `${structure.routes.length} routes, ${structure.tables.length} tables, ${structure.components.length} components, ${structure.apiCalls.length} API calls${commitNote}`,
      ...(artifacts.length > 0 ? { artifacts } : {}),
    }
  },

  existing_tests: async (ctx, checkId) => {
    const pkg = readPackageJson(ctx.workspace)
    if (!pkg) return { status: 'skipped', message: 'No package.json found — no test suite detected' }
    const scripts = (pkg.scripts ?? {}) as Record<string, string>
    const testScript = scripts.test
    if (!testScript || /no test specified/i.test(testScript)) {
      return { status: 'skipped', message: 'No test script defined in package.json' }
    }

    const deps = await prepareDependencies(ctx)
    if (!deps.ok) return { status: 'skipped', message: `Could not prepare dependencies: ${deps.note}` }

    const result = await runInSandbox({
      workspaceDir: ctx.workspace,
      command: 'npm test --silent',
      network: 'none',
    })
    if (!result.ran) return { status: 'skipped', message: `Sandbox unavailable: ${result.error}` }

    const artifacts: ArtifactRow[] = []
    const log = combinedLog(result)
    let logArtifact: ArtifactRow | null = null
    if (log.trim()) {
      logArtifact = await saveLogArtifact(ctx.runId, checkId, 'test-output.log', log)
      artifacts.push(logArtifact)
    }

    // TODO(ml): parse individual test names/outcomes from the runner output and ask the
    // flaky-test classifier at ML_SERVICE_URL /ml/flaky (gradient-boosted model over
    // pass/fail history + durations) to fill test_results.flaky_probability per test.
    const failureFinding = async (title: string, description: string): Promise<void> => {
      if (!logArtifact) return
      await createFindings([
        {
          runId: ctx.runId,
          projectId: ctx.projectId,
          severity: 'high',
          category: 'api',
          title,
          description,
          whyItMatters:
            'The repository ships its own failing tests — every downstream check result is built on unstable code.',
          fixSteps: ['Run the test suite locally and fix the failing assertions', 'Re-run the verification afterwards'],
          evidenceRefs: [{ type: 'artifact', id: logArtifact.id }],
          evidence: [
            {
              kind: 'log',
              title: 'Test suite output (tail)',
              content: log.slice(-4000),
              language: 'text',
            },
          ],
        },
      ])
    }

    if (result.timedOut) {
      await failureFinding(
        'Existing test suite timed out',
        `\`npm test\` did not finish within ${env.SANDBOX_TIMEOUT_SEC}s in the sandbox.`,
      )
      return {
        status: 'failed',
        message: `Test suite timed out after ${env.SANDBOX_TIMEOUT_SEC}s`,
        artifacts,
        durationMs: result.durationMs,
      }
    }
    if (result.exitCode === 0) {
      return {
        status: 'passed',
        message: `Test script "npm test" passed in ${(result.durationMs / 1000).toFixed(1)}s`,
        exitCode: 0,
        durationMs: result.durationMs,
        artifacts,
      }
    }
    await failureFinding(
      `Existing test suite failed: exit code ${result.exitCode}`,
      `\`npm test\` exited with code ${result.exitCode} inside the sandbox.`,
    )
    return {
      status: 'failed',
      message: `Test script exited with code ${result.exitCode}`,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      artifacts,
    }
  },

  api_tests: async (ctx, checkId) => {
    const routes = ctx.structure.routes.filter((route) => route.path.startsWith('/'))
    if (routes.length === 0) return { status: 'skipped', message: 'No API routes detected' }

    const startCommand = startCommandFor(ctx.workspace)
    if (!startCommand) {
      return { status: 'skipped', message: 'No start script found — cannot boot the app in a sandbox' }
    }

    const deps = await prepareDependencies(ctx)
    if (!deps.ok) return { status: 'skipped', message: `Could not prepare dependencies: ${deps.note}` }

    const plan = {
      port: SANDBOX_PORT,
      startCommand,
      startTimeoutMs: 25_000,
      auth: detectAuthPlan(routes),
      routes: routes.map((route) => ({ method: route.method, path: route.path, auth: route.auth })),
    }
    const invocation = await invokeRunner(ctx, {
      dirName: 'api',
      runnerFile: 'api-tests.mjs',
      plan,
    })

    const artifacts: ArtifactRow[] = []
    if (invocation.consoleLog.trim()) {
      artifacts.push(await saveLogArtifact(ctx.runId, checkId, 'api-tests-console.log', invocation.consoleLog))
    }
    if (!invocation.ran) {
      return { status: 'skipped', message: `Sandbox unavailable: ${invocation.error}`, durationMs: invocation.durationMs, artifacts }
    }

    const parsed = await readJsonFile<ApiTestsOutput>(path.join(invocation.outDir, 'api-results.json'))
    if (!parsed) {
      return { status: 'failed', message: 'API test runner produced no results', durationMs: invocation.durationMs, artifacts }
    }

    const resultsArtifact = await saveLogArtifact(
      ctx.runId,
      checkId,
      'api-results.json',
      JSON.stringify(parsed, null, 2),
      'report',
    )
    artifacts.push(resultsArtifact)

    if (!parsed.serverStarted) {
      return {
        status: 'failed',
        message: 'Application did not start inside the sandbox (see start log)',
        durationMs: invocation.durationMs,
        artifacts,
      }
    }

    const failures = parsed.results.filter((entry) => !entry.ok)
    // Missing-token failures belong to the security stage — no duplicate findings here.
    const findingFailures = failures.filter((entry) => entry.test !== 'missing-token').slice(0, MAX_FINDINGS_PER_CHECK)
    if (findingFailures.length > 0) {
      await createFindings(
        findingFailures.map((failure) => apiFailureFinding(ctx, resultsArtifact, failure)),
      )
    }

    const total = parsed.results.length
    const passed = total - failures.length
    if (failures.length > 0) {
      const first = failures[0]
      return {
        status: 'failed',
        message: `${passed}/${total} API contract tests passed — first failure: ${first?.test} ${first?.method} ${first?.path}`,
        durationMs: invocation.durationMs,
        artifacts,
      }
    }
    return {
      status: 'passed',
      message: `${passed}/${total} API contract tests passed${parsed.authTokenObtained ? '' : ' (no token obtainable — authenticated-path tests were limited)'}`,
      durationMs: invocation.durationMs,
      artifacts,
    }
  },

  data_fetch: async (ctx, checkId) => {
    const calls = ctx.structure.apiCalls
    if (calls.length === 0) return { status: 'skipped', message: 'No frontend API calls detected' }

    const startCommand = startCommandFor(ctx.workspace)
    if (!startCommand) {
      return { status: 'skipped', message: 'No start script found — cannot boot the app in a sandbox' }
    }
    const deps = await prepareDependencies(ctx)
    if (!deps.ok) return { status: 'skipped', message: `Could not prepare dependencies: ${deps.note}` }

    const routes = ctx.structure.routes
    const plan = {
      port: SANDBOX_PORT,
      startCommand,
      startTimeoutMs: 25_000,
      auth: detectAuthPlan(routes),
      calls: calls.map((call) => {
        const route = matchRoute(call.method, call.path, routes)
        return {
          method: call.method,
          path: call.path,
          needsAuth: route ? route.auth === 'user' || route.auth === 'admin' : false,
        }
      }),
    }
    const invocation = await invokeRunner(ctx, {
      dirName: 'data-fetch',
      runnerFile: 'data-fetch.mjs',
      plan,
      timeoutSec: 180,
    })

    const artifacts: ArtifactRow[] = []
    if (invocation.consoleLog.trim()) {
      artifacts.push(await saveLogArtifact(ctx.runId, checkId, 'data-fetch-console.log', invocation.consoleLog))
    }
    if (!invocation.ran) {
      return { status: 'skipped', message: `Sandbox unavailable: ${invocation.error}`, durationMs: invocation.durationMs, artifacts }
    }

    const parsed = await readJsonFile<DataFetchOutput>(
      path.join(invocation.outDir, 'data-fetch-results.json'),
    )
    if (!parsed) {
      return { status: 'failed', message: 'Data-fetch runner produced no results', durationMs: invocation.durationMs, artifacts }
    }
    const reportArtifact = await saveLogArtifact(
      ctx.runId,
      checkId,
      'data-fetch-report.json',
      JSON.stringify(parsed, null, 2),
      'report',
    )
    artifacts.push(reportArtifact)

    if (!parsed.serverStarted) {
      return {
        status: 'failed',
        message: 'Application did not start inside the sandbox (see start log)',
        durationMs: invocation.durationMs,
        artifacts,
      }
    }

    const noToken = parsed.authTokenObtained === false
    type Evaluation = { entry: DataFetchEntry; broken: boolean; note: string }
    const evaluations: Evaluation[] = parsed.results.map((entry) => {
      const route = matchRoute(entry.method, entry.path, routes)
      if (entry.error || entry.httpStatus === null) {
        return { entry, broken: true, note: entry.error ?? 'request failed' }
      }
      if (entry.httpStatus < 400) return { entry, broken: false, note: `HTTP ${entry.httpStatus}` }
      if ((entry.httpStatus === 401 || entry.httpStatus === 403) && noToken) {
        return { entry, broken: false, note: `HTTP ${entry.httpStatus} — auth-gated, no token available` }
      }
      if (entry.httpStatus === 404 && !route) {
        // The call targets a route that does not exist — the data-mapping check owns this.
        return { entry, broken: false, note: 'HTTP 404 — no matching route; reported by the data-mapping check' }
      }
      return { entry, broken: true, note: `HTTP ${entry.httpStatus}` }
    })

    await updateApiCallStatus(
      ctx.projectId,
      evaluations.map((evaluation) => ({
        path: evaluation.entry.path,
        status: evaluation.broken ? ('broken' as const) : ('ok' as const),
        ...(evaluation.broken ? { note: evaluation.note } : {}),
      })),
    )
    await updateRouteIssues(
      ctx.projectId,
      evaluations
        .filter((evaluation) => evaluation.broken && (evaluation.entry.httpStatus ?? 0) >= 500)
        .map((evaluation) => {
          const route = matchRoute(evaluation.entry.method, evaluation.entry.path, routes)
          return {
            method: evaluation.entry.method,
            path: route?.path ?? evaluation.entry.path,
            issue: `HTTP ${evaluation.entry.httpStatus} during data fetch`,
          }
        }),
    )

    const broken = evaluations.filter((evaluation) => evaluation.broken)
    if (broken.length > 0) {
      await createFindings(
        broken.slice(0, MAX_FINDINGS_PER_CHECK).map((evaluation) =>
          dataFetchFinding(ctx, reportArtifact, evaluation.entry, evaluation.note),
        ),
      )
    }

    const total = evaluations.length
    if (broken.length === 0) {
      return {
        status: 'passed',
        message: `All ${total} frontend API call${total === 1 ? '' : 's'} returned successful responses`,
        durationMs: invocation.durationMs,
        artifacts,
      }
    }
    const first = broken[0]
    return {
      status: 'failed',
      message: `${broken.length}/${total} frontend API calls failed at runtime — first: ${first?.entry.method} ${first?.entry.path} (${first?.note})`,
      durationMs: invocation.durationMs,
      artifacts,
    }
  },

  mapping: async (ctx, checkId) => {
    const calls = ctx.structure.apiCalls
    const routes = ctx.structure.routes.filter((route) => route.path.startsWith('/'))
    if (calls.length === 0) return { status: 'skipped', message: 'No frontend API calls detected' }
    if (routes.length === 0) {
      return { status: 'skipped', message: 'No backend routes detected to map against' }
    }

    const entries = calls.map((call) => {
      const route = matchRoute(call.method, call.path, routes)
      return {
        from: call.from,
        method: call.method,
        path: call.path,
        matched: Boolean(route),
        ...(route ? { route: `${route.method} ${route.path}`, file: route.file } : {}),
      }
    })
    const unmatched = entries.filter((entry) => !entry.matched)

    const report = {
      summary: { total: entries.length, matched: entries.length - unmatched.length, unmatched: unmatched.length },
      calls: entries,
    }
    const reportArtifact = await saveLogArtifact(
      ctx.runId,
      checkId,
      'mapping-report.json',
      JSON.stringify(report, null, 2),
      'report',
    )

    if (unmatched.length === 0) {
      return {
        status: 'passed',
        message: `All ${entries.length} frontend calls map to backend routes`,
        artifacts: [reportArtifact],
      }
    }

    await createFindings(
      unmatched.slice(0, MAX_FINDINGS_PER_CHECK).map((entry) => ({
        runId: ctx.runId,
        projectId: ctx.projectId,
        severity: 'high' as SeverityRow,
        category: 'mapping' as const,
        title: `Frontend call has no backend route: ${entry.method} ${entry.path}`,
        description: `${entry.from} calls ${entry.method} ${entry.path}, but the backend exposes no matching route.`,
        whyItMatters:
          'The UI will render an error state for this call because the request cannot succeed as written.',
        fixSteps: [
          `Add a ${entry.method} ${entry.path} handler on the backend, or`,
          `Correct the URL in ${entry.from} so it matches an existing route`,
        ],
        filePath: entry.from,
        endpoint: `${entry.method} ${entry.path}`,
        evidenceRefs: [{ type: 'artifact', id: reportArtifact.id }],
        evidence: [
          {
            kind: 'log',
            title: 'Mapping report',
            content: `${entry.method} ${entry.path} (from ${entry.from}) → no matching backend route`,
            language: 'text',
          },
        ],
      })),
    )

    const first = unmatched[0]
    return {
      status: 'failed',
      message: `${unmatched.length}/${entries.length} frontend calls have no matching backend route — first: ${first?.method} ${first?.path}`,
      artifacts: [reportArtifact],
    }
  },

  database: async (ctx, checkId) => {
    if (ctx.structure.tables.length === 0) {
      return { status: 'skipped', message: 'No database schema detected (.sql files with CREATE TABLE)' }
    }

    const outcome = await runDatabaseCheck(ctx.workspace, ctx.structure.tables)
    if (outcome.status === 'skipped') {
      return { status: 'skipped', message: outcome.message, durationMs: outcome.durationMs }
    }

    const artifacts: ArtifactRow[] = []
    const reportArtifact = await saveLogArtifact(
      ctx.runId,
      checkId,
      'database-report.json',
      outcome.reportJson,
      'report',
    )
    artifacts.push(reportArtifact)
    if (outcome.logExcerpt.trim()) {
      artifacts.push(await saveLogArtifact(ctx.runId, checkId, 'database-check.log', outcome.logExcerpt))
    }

    await createFindings(
      outcome.issues.slice(0, MAX_FINDINGS_PER_CHECK).map((issue) => ({
        runId: ctx.runId,
        projectId: ctx.projectId,
        severity: (issue.kind === 'missing_column' ? 'medium' : 'high') as SeverityRow,
        category: 'database' as const,
        title: issue.title,
        description: issue.message,
        whyItMatters:
          'Applying the checked-in schema does not recreate what the code queries, so runtime queries will fail.',
        fixSteps: [
          `Apply the schema files to an empty database and compare with the expected shape`,
          `Update ${issue.file ?? 'the schema files'} so ${issue.table ?? 'the missing object'} is created`,
        ],
        ...(issue.file ? { filePath: issue.file } : {}),
        ...(issue.table ? { dbTable: issue.table } : {}),
        evidenceRefs: [{ type: 'artifact', id: reportArtifact.id }],
        evidence: [
          {
            kind: 'log',
            title: `Database verification: ${issue.title}`,
            content: outcome.logExcerpt || issue.message,
            language: 'text',
          },
        ],
      })),
    )

    return {
      status: outcome.status,
      message: outcome.message,
      durationMs: outcome.durationMs,
      artifacts,
    }
  },

  load: async (ctx, checkId) => {
    const candidates = ctx.structure.routes.filter(
      (route) => route.path.startsWith('/') && route.method.toUpperCase() === 'GET' && route.auth !== 'admin',
    )
    if (candidates.length === 0) {
      return { status: 'skipped', message: 'No GET routes suitable for a load test' }
    }

    const startCommand = startCommandFor(ctx.workspace)
    if (!startCommand) {
      return { status: 'skipped', message: 'No start script found — cannot boot the app in a sandbox' }
    }
    const deps = await prepareDependencies(ctx)
    if (!deps.ok) return { status: 'skipped', message: `Could not prepare dependencies: ${deps.note}` }

    const loadUsers = Math.max(1, ctx.run.loadUsers)
    const levels = [...new Set([1, 10, 50, loadUsers].filter((level) => level >= 1 && level <= loadUsers))].sort(
      (left, right) => left - right,
    )
    const durationSec = 4

    const plan = {
      port: SANDBOX_PORT,
      startCommand,
      startTimeoutMs: 25_000,
      auth: detectAuthPlan(ctx.structure.routes),
      durationSec,
      levels,
      routes: candidates.map((route) => ({
        path: route.path,
        method: 'GET',
        needsAuth: route.auth === 'user',
      })),
    }
    const invocation = await invokeRunner(ctx, {
      dirName: 'load',
      runnerFile: 'load-test.mjs',
      plan,
      timeoutSec: 480,
    })

    const artifacts: ArtifactRow[] = []
    if (invocation.consoleLog.trim()) {
      artifacts.push(await saveLogArtifact(ctx.runId, checkId, 'load-console.log', invocation.consoleLog))
    }
    if (!invocation.ran) {
      return { status: 'skipped', message: `Sandbox unavailable: ${invocation.error}`, durationMs: invocation.durationMs, artifacts }
    }

    const parsed = await readJsonFile<LoadTestOutput>(path.join(invocation.outDir, 'load-results.json'))
    if (!parsed) {
      return { status: 'failed', message: 'Load-test runner produced no results', durationMs: invocation.durationMs, artifacts }
    }
    if (!parsed.autocannonAvailable) {
      return { status: 'skipped', message: 'autocannon is not available in the sandbox image', durationMs: invocation.durationMs, artifacts }
    }
    const reportArtifact = await saveLogArtifact(
      ctx.runId,
      checkId,
      'load-report.json',
      JSON.stringify(parsed, null, 2),
      'report',
    )
    artifacts.push(reportArtifact)

    if (!parsed.serverStarted) {
      return {
        status: 'failed',
        message: 'Application did not start inside the sandbox (see start log)',
        durationMs: invocation.durationMs,
        artifacts,
      }
    }

    const thresholds = thresholdsFor(ctx.project)
    interface Breach {
      route: string
      method: string
      users: number
      p95Ms: number
      errorRatePct: number
      reason: string
    }
    const breaches: Breach[] = []
    const routeSummaries: string[] = []
    const skippedNotes: string[] = []

    for (const routeResult of parsed.results) {
      if (routeResult.note) {
        skippedNotes.push(`${routeResult.method} ${routeResult.route}: ${routeResult.note}`)
        continue
      }
      let breachFound = false
      const tableLines: string[] = [`${routeResult.method} ${routeResult.route}`, '  users | avg | p95 | err% | rps']
      for (const level of routeResult.levels) {
        const p95Ms = level.p95Ms
        const errorRatePct = level.errorRatePct
        if (level.error || typeof p95Ms !== 'number' || typeof errorRatePct !== 'number') {
          skippedNotes.push(
            `${routeResult.method} ${routeResult.route} @ ${level.users} users: ${level.error ?? 'no metrics'}`,
          )
          continue
        }
        const errorBreach = errorRatePct > thresholds.errorRatePct
        const p95Breach = p95Ms > thresholds.p95Ms
        const isFirstBreach = (errorBreach || p95Breach) && !breachFound
        if (isFirstBreach) breachFound = true

        await insertLoadResult({
          runId: ctx.runId,
          route: routeResult.route,
          method: routeResult.method,
          users: level.users,
          avgMs: level.avgMs ?? null,
          p50Ms: level.p50Ms ?? null,
          p95Ms,
          p99Ms: level.p99Ms ?? null,
          errorRatePct,
          requestsPerSec: level.requestsPerSecond ?? null,
          dbConnectionErrors: 0,
          isBreakingPoint: isFirstBreach,
          // TODO(ml): replace this null with a bottleneck label from a regression
          // model on the latency/error curves, served at ML_SERVICE_URL /v1/load/bottleneck.
          bottleneck: null,
        })

        tableLines.push(
          `  ${String(level.users).padStart(5)} | ${String(level.avgMs ?? '-')}ms | ${p95Ms}ms | ${errorRatePct}% | ${level.requestsPerSecond ?? '-'}`,
        )

        if (isFirstBreach) {
          breaches.push({
            route: routeResult.route,
            method: routeResult.method,
            users: level.users,
            p95Ms,
            errorRatePct,
            reason: errorBreach
              ? `error rate ${errorRatePct}% exceeds the ${thresholds.errorRatePct}% threshold`
              : `p95 ${p95Ms}ms exceeds the ${thresholds.p95Ms}ms threshold`,
          })
        }
      }
      if (tableLines.length > 2) routeSummaries.push(tableLines.join('\n'))
    }

    // Ship the full per-route ramp to the UI so the charts render immediately.
    const storedRows = await listLoadResultsForRun(ctx.runId)
    runEvents.publish(ctx.runId, {
      type: 'load',
      data: toApiLoadTestResult(ctx.runId, storedRows, thresholds),
    })

    if (breaches.length > 0) {
      await createFindings(
        breaches.slice(0, MAX_FINDINGS_PER_CHECK).map((breach) => ({
          runId: ctx.runId,
          projectId: ctx.projectId,
          severity: (breach.errorRatePct > thresholds.errorRatePct ? 'high' : 'medium') as SeverityRow,
          category: 'performance' as const,
          title: `Load breach: ${breach.method} ${breach.route} at ${breach.users} connections`,
          description: `${breach.reason} (p95 ${breach.p95Ms}ms, error rate ${breach.errorRatePct}% at ${breach.users} connections).`,
          whyItMatters:
            'Real traffic at this concurrency level produces errors or slow responses that users will notice.',
          fixSteps: [
            'Profile the handler under load and look for blocking calls',
            'Check database connection pool size and slow queries',
            'Consider caching or pagination for the slowest responses',
          ],
          endpoint: `${breach.method} ${breach.route}`,
          evidenceRefs: [{ type: 'artifact', id: reportArtifact.id }],
          evidence: [
            {
              kind: 'log',
              title: 'Load ramp summary',
              content: routeSummaries.join('\n\n') || breach.reason,
              language: 'text',
            },
          ],
        })),
      )
    }

    const maxUsers = levels[levels.length - 1] ?? 1
    const notes = [...skippedNotes, ...(parsed.authTokenObtained === false ? ['no auth token was obtainable — authenticated routes were skipped'] : [])]
    const noteSuffix = notes.length > 0 ? ` (${notes.join('; ')})` : ''

    if (breaches.length === 0) {
      return {
        status: 'passed',
        message: `${candidates.length} route${candidates.length === 1 ? '' : 's'} ramped 1→${maxUsers} connections with no threshold breach${noteSuffix}`,
        durationMs: invocation.durationMs,
        artifacts,
      }
    }
    const first = breaches[0]
    return {
      status: 'failed',
      message: `${breaches.length} route${breaches.length === 1 ? '' : 's'} breached load thresholds — first: ${first?.method} ${first?.route} at ${first?.users} connections (${first?.reason})`,
      durationMs: invocation.durationMs,
      artifacts,
    }
  },

  security: async (ctx, checkId) => {
    const routes = ctx.structure.routes.filter((route) => route.path.startsWith('/'))
    const artifacts: ArtifactRow[] = []
    const notes: string[] = []
    const findings: FindingInput[] = []

    // 1) Runtime probe — who answers without an Authorization header?
    const startCommand = startCommandFor(ctx.workspace)
    if (routes.length === 0) {
      notes.push('probe skipped: no routes detected')
    } else if (!startCommand) {
      notes.push('probe skipped: no start script')
    } else {
      const deps = await prepareDependencies(ctx)
      if (!deps.ok) {
        notes.push(`probe skipped: ${deps.note}`)
      } else {
        const plan = {
          port: SANDBOX_PORT,
          startCommand,
          startTimeoutMs: 25_000,
          routes: routes.map((route) => ({ method: route.method, path: route.path, auth: route.auth })),
        }
        const invocation = await invokeRunner(ctx, {
          dirName: 'security',
          runnerFile: 'security-probe.mjs',
          plan,
          timeoutSec: 180,
        })
        if (invocation.consoleLog.trim()) {
          artifacts.push(await saveLogArtifact(ctx.runId, checkId, 'security-console.log', invocation.consoleLog))
        }
        const probe = invocation.ran
          ? await readJsonFile<SecurityProbeOutput>(path.join(invocation.outDir, 'security-probe.json'))
          : null
        if (probe) {
          const probeArtifact = await saveLogArtifact(
            ctx.runId,
            checkId,
            'security-probe.json',
            JSON.stringify(probe, null, 2),
            'report',
          )
          artifacts.push(probeArtifact)

          if (!probe.serverStarted) {
            notes.push('app did not start — route probing inconclusive')
          } else {
            const routeIssues: Array<{ method: string; path: string; issue: string }> = []
            let unprotected = 0
            for (const entry of probe.results) {
              const route = routes.find(
                (candidate) => candidate.method === entry.method && candidate.path === entry.path,
              )
              if (entry.error || entry.httpStatus === null) {
                notes.push(`${entry.method} ${entry.path}: probe request failed`)
                continue
              }
              if (entry.denied) continue
              if (entry.httpStatus === 404) {
                notes.push(`${entry.method} ${entry.path}: not reachable (404) — cannot judge`)
                continue
              }
              if (entry.httpStatus >= 500) {
                notes.push(`${entry.method} ${entry.path}: server error without auth — inconclusive`)
                continue
              }
              if (entry.auth === 'user' || entry.auth === 'admin') {
                unprotected += 1
                routeIssues.push({ method: entry.method, path: entry.path, issue: 'responds without authentication' })
                findings.push({
                  runId: ctx.runId,
                  projectId: ctx.projectId,
                  severity: 'critical',
                  category: 'security',
                  title: `Unprotected route: ${entry.method} ${entry.path}`,
                  description: `The scan marked this route as ${entry.auth}-authenticated, but it answered HTTP ${entry.httpStatus} without any Authorization header.`,
                  whyItMatters:
                    'Anyone who can reach the API can use this endpoint without logging in — classic broken access control.',
                  fixSteps: [
                    'Attach the authentication middleware to this route',
                    'Add a regression test asserting 401 without a token',
                  ],
                  ...(route ? { filePath: route.file } : {}),
                  endpoint: `${entry.method} ${entry.path}`,
                  evidenceRefs: [{ type: 'artifact', id: probeArtifact.id }],
                  evidence: [
                    {
                      kind: 'http',
                      title: `Unauthenticated response for ${entry.method} ${entry.path}`,
                      method: entry.method,
                      url: `http://127.0.0.1:${SANDBOX_PORT}${entry.path}`,
                      status: entry.httpStatus,
                      responseBody: entry.responseExcerpt ?? '',
                    },
                  ],
                })
              } else if (entry.auth === 'none-detected' && entry.httpStatus < 400) {
                routeIssues.push({
                  method: entry.method,
                  path: entry.path,
                  issue: 'auth unclear from static scan — responds without authentication',
                })
                findings.push({
                  runId: ctx.runId,
                  projectId: ctx.projectId,
                  severity: 'medium',
                  category: 'security',
                  title: `Auth unclear on route: ${entry.method} ${entry.path}`,
                  description: `The static scan could not tell whether this route requires authentication, and it answered HTTP ${entry.httpStatus} without a token.`,
                  whyItMatters:
                    'If this route was meant to be protected, it is currently open to anyone; if it is public, this is informational.',
                  fixSteps: [
                    'Confirm whether the route should require authentication',
                    'If yes, attach the auth middleware; if no, mark it as intentionally public',
                  ],
                  ...(route ? { filePath: route.file } : {}),
                  endpoint: `${entry.method} ${entry.path}`,
                  evidenceRefs: [{ type: 'artifact', id: probeArtifact.id }],
                  evidence: [
                    {
                      kind: 'http',
                      title: `Unauthenticated response for ${entry.method} ${entry.path}`,
                      method: entry.method,
                      url: `http://127.0.0.1:${SANDBOX_PORT}${entry.path}`,
                      status: entry.httpStatus,
                      responseBody: entry.responseExcerpt ?? '',
                    },
                  ],
                })
              }
            }
            await updateRouteIssues(ctx.projectId, routeIssues)
            notes.push(`${probe.results.length} route(s) probed — ${unprotected} unprotected`)
          }
        }
      }
    }

    // 2) Static analysis tools.
    const semgrep = await runSemgrep(ctx.workspace)
    notes.push(semgrep.note)
    const semgrepArtifact = await saveLogArtifact(
      ctx.runId,
      checkId,
      'semgrep-report.json',
      semgrep.reportJson,
      'report',
    )
    artifacts.push(semgrepArtifact)
    for (const issue of semgrep.issues) {
      findings.push({
        runId: ctx.runId,
        projectId: ctx.projectId,
        severity: issue.severity,
        category: 'security',
        title: issue.title,
        description: issue.message,
        ...(issue.file ? { filePath: issue.file } : {}),
        ...(issue.line ? { lineNumber: issue.line } : {}),
        evidenceRefs: [{ type: 'artifact', id: semgrepArtifact.id }],
        evidence: [
          {
            kind: 'log',
            title: 'Semgrep finding',
            content: `${issue.title}\n${issue.message}${issue.file ? `\n${issue.file}:${issue.line ?? ''}` : ''}`,
            language: 'text',
          },
        ],
      })
    }

    const toolsDir = path.resolve('storage', 'runs', ctx.runId, 'security', 'tools')
    await mkdir(toolsDir, { recursive: true })
    const gitleaks = await runGitleaks(ctx.workspace, toolsDir)
    notes.push(gitleaks.note)
    const gitleaksArtifact = await saveLogArtifact(
      ctx.runId,
      checkId,
      'gitleaks-report.json',
      gitleaks.reportJson,
      'report',
    )
    artifacts.push(gitleaksArtifact)
    for (const issue of gitleaks.issues) {
      findings.push({
        runId: ctx.runId,
        projectId: ctx.projectId,
        severity: 'critical',
        category: 'security',
        title: issue.title,
        description: issue.message,
        ...(issue.file ? { filePath: issue.file } : {}),
        ...(issue.line ? { lineNumber: issue.line } : {}),
        evidenceRefs: [{ type: 'artifact', id: gitleaksArtifact.id }],
        evidence: [
          {
            kind: 'log',
            title: 'Secret scan (value redacted)',
            content: `${issue.title}\n${issue.message}${issue.file ? `\n${issue.file}:${issue.line ?? ''}` : ''}`,
            language: 'text',
          },
        ],
      })
    }

    const audit = await runNpmAudit(ctx.workspace)
    notes.push(audit.note)
    const auditArtifact = await saveLogArtifact(
      ctx.runId,
      checkId,
      'npm-audit-report.json',
      audit.reportJson,
      'report',
    )
    artifacts.push(auditArtifact)
    for (const issue of audit.issues) {
      findings.push({
        runId: ctx.runId,
        projectId: ctx.projectId,
        severity: issue.severity,
        category: 'security',
        title: issue.title,
        description: issue.message,
        evidenceRefs: [{ type: 'artifact', id: auditArtifact.id }],
        evidence: [
          {
            kind: 'log',
            title: 'Dependency advisory',
            content: `${issue.title}\n${issue.message}`,
            language: 'text',
          },
        ],
      })
    }

    await createFindings(findings.slice(0, MAX_SECURITY_FINDINGS))

    const criticalCount = findings.filter((finding) => finding.severity === 'critical').length
    const highCount = findings.filter((finding) => finding.severity === 'high').length
    const failed = criticalCount > 0 || highCount > 0
    const noteSuffix = notes.filter(Boolean).join('; ')

    if (!failed) {
      return {
        status: 'passed',
        message: `No critical or high security issues — ${noteSuffix || 'all tools clean'}`,
        artifacts,
      }
    }
    const first = findings.find((finding) => finding.severity === 'critical' || finding.severity === 'high')
    return {
      status: 'failed',
      message: `Security baseline failed: ${criticalCount} critical, ${highCount} high — first: ${first?.title ?? 'unknown'}`,
      artifacts,
    }
  },
}

function apiFailureFinding(
  ctx: StageContext,
  resultsArtifact: ArtifactRow,
  failure: ApiTestEntry,
): FindingInput {
  const endpoint = `${failure.method} ${failure.path}`
  let title = `API contract failure: ${endpoint}`
  if (failure.test === 'valid-token') title = `Authenticated request rejected: ${endpoint}`
  else if (failure.test === 'wrong-role') title = `Admin route accepted a non-admin token: ${endpoint}`
  else if (failure.test === 'public-reachable') title = `Public route returned a server error: ${endpoint}`
  return {
    runId: ctx.runId,
    projectId: ctx.projectId,
    severity: failure.test === 'wrong-role' ? 'critical' : 'high',
    category: 'api',
    title,
    description:
      failure.note ??
      `${failure.test} assertion failed (expected ${JSON.stringify(failure.expected)}, got ${failure.actual ?? 'no response'})`,
    endpoint,
    whyItMatters:
      failure.test === 'wrong-role'
        ? 'A non-admin user can reach an admin-only endpoint — privilege escalation.'
        : 'The API contract this route promises is broken for a real caller.',
    fixSteps: [
      'Reproduce the request against a locally running instance',
      failure.test === 'wrong-role'
        ? 'Enforce the admin role check in the route middleware'
        : 'Fix the handler or the authentication wiring so the expected response is returned',
    ],
    evidenceRefs: [{ type: 'artifact', id: resultsArtifact.id }],
    evidence: [
      {
        kind: 'log',
        title: `API test result (${failure.test})`,
        content: JSON.stringify(failure, null, 2),
        language: 'json',
      },
    ],
  }
}

function dataFetchFinding(
  ctx: StageContext,
  reportArtifact: ArtifactRow,
  entry: DataFetchEntry,
  note: string,
): FindingInput {
  const endpoint = `${entry.method} ${entry.path}`
  return {
    runId: ctx.runId,
    projectId: ctx.projectId,
    severity: 'high',
    category: 'data',
    title: `Data fetch failed: ${endpoint}`,
    description: `The frontend call ${endpoint} returned ${note} when exercised against the running application.`,
    endpoint,
    whyItMatters:
      'A frontend call that fails at runtime means the corresponding screen shows an error or empty state for real users.',
    fixSteps: [
      'Run the application and replay this request to see the failure firsthand',
      'Fix the handler or the request so it returns a successful response',
    ],
    evidenceRefs: [{ type: 'artifact', id: reportArtifact.id }],
    evidence: [
      {
        kind: 'http',
        title: `Observed response for ${endpoint}`,
        method: entry.method,
        url: `http://127.0.0.1:${SANDBOX_PORT}${entry.path}`,
        status: entry.httpStatus ?? 0,
        responseBody: entry.responseExcerpt ?? entry.error ?? note,
      },
    ],
  }
}

/* ------------------------------- Executor ---------------------------------- */

async function executeStage(spec: StageSpec, ctx: StageContext): Promise<void> {
  const check = ctx.checks.get(spec.type)
  if (!check) return

  const startedAt = new Date()
  const runningStage = await updateRunStage(ctx.runId, spec.stage, { status: 'running', startedAt })
  await updateCheck(check.id, { status: 'running', startedAt })
  runEvents.publish(ctx.runId, { type: 'stage', data: toStreamStage(runningStage) })
  await publishCheck(ctx.runId, { ...check, status: 'running', startedAt })

  let result: StageResult
  try {
    result = await stageHandlers[spec.stage](ctx, check.id)
  } catch (error) {
    logger.error({ err: error, runId: ctx.runId, stage: spec.stage }, 'Stage handler crashed')
    result = {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Stage crashed unexpectedly',
    }
  }

  const finishedAt = new Date()
  const durationMs = result.durationMs ?? finishedAt.getTime() - startedAt.getTime()

  const updatedCheck = await updateCheck(check.id, {
    status: result.status,
    message: result.message,
    durationMs,
    finishedAt,
    ...(result.exitCode !== undefined ? { exitCode: result.exitCode } : {}),
  })
  const finishedStage = await updateRunStage(ctx.runId, spec.stage, {
    status: result.status,
    message: result.message,
    finishedAt,
  })

  runEvents.publish(ctx.runId, { type: 'stage', data: toStreamStage(finishedStage) })
  await publishCheck(ctx.runId, updatedCheck)

  const stages = await listRunStages(ctx.runId)
  publishProgress(ctx.runId, stages)
}

export async function executeRun(runId: string, projectId: string): Promise<void> {
  const initial = await findRunById(runId)
  if (!initial) {
    logger.warn({ runId }, 'Run vanished before the worker picked it up')
    return
  }
  if (initial.status !== 'queued') return

  const project = await findProjectById(projectId)
  if (!project) {
    await updateRun(runId, { status: 'error', finishedAt: new Date(), summary: 'Project no longer exists' })
    return
  }

  await updateRun(runId, { status: 'running', startedAt: new Date() })
  runEvents.publish(runId, { type: 'status', data: { status: 'running', healthScore: null } })

  const checkRows = await listChecksForRun(runId, { limit: 50, offset: 0 })
  const checks = new Map<CheckTypeRow, CheckRow>()
  for (const row of checkRows.rows) checks.set(row.type, row)

  const stored = await findStructure(projectId)
  const ctx: StageContext = {
    run: initial,
    project,
    projectId,
    runId,
    workspace: workspaceDir(projectId),
    structure: stored?.data ?? EMPTY_STRUCTURE,
    checks,
    depsReady: null,
  }

  const selectedChecks = readSelectedChecks(initial.environment)
  for (const spec of STAGE_SPECS) {
    const fresh = await findRunById(runId)
    if (!fresh || fresh.status === 'cancelled') {
      await skipRemainingStages(runId, spec.stage)
      break
    }
    if (selectedChecks && !selectedChecks.includes(spec.type)) {
      await skipStageNotSelected(ctx, spec)
      continue
    }
    await executeStage(spec, ctx)
  }

  const finalRun = await findRunById(runId)
  if (!finalRun || finalRun.status === 'cancelled') {
    // Cancellation already published its own terminal event.
    return
  }

  const stats = await checkStatsForRun(runId)
  const severity = await severityCountsForRun(runId)
  const failed = stats.failedChecks > 0

  // Health score: base 100, −10 per failed check, then finding severity weights.
  const penalty =
    stats.failedChecks * 10 + severity.critical * 10 + severity.high * 5 + severity.medium * 2 + severity.low
  const healthScore = Math.max(0, Math.min(100, Math.round((100 - penalty) * 100) / 100))

  const findingCount = severity.critical + severity.high + severity.medium + severity.low
  const status = failed ? 'failed' : 'passed'
  const summary = failed
    ? `${stats.failedChecks} of ${stats.totalChecks} checks failed${findingCount > 0 ? ` — ${findingCount} finding${findingCount === 1 ? '' : 's'} recorded` : ''}`
    : findingCount > 0
      ? `All ${stats.totalChecks} checks completed — ${findingCount} finding${findingCount === 1 ? '' : 's'} recorded`
      : `All ${stats.totalChecks} checks completed`

  await updateRun(runId, { status, healthScore, finishedAt: new Date(), summary })
  await publishTerminal(runId)
}

/** `checks[]` on the run body: when present, only these check types execute. */
function readSelectedChecks(environment: Record<string, unknown>): string[] | null {
  const raw = environment.checks
  if (!Array.isArray(raw)) return null
  const valid = raw.filter((entry): entry is string => typeof entry === 'string')
  return valid.length > 0 ? valid : null
}

async function skipStageNotSelected(ctx: StageContext, spec: StageSpec): Promise<void> {
  const updatedStage = await updateRunStage(ctx.runId, spec.stage, {
    status: 'skipped',
    message: 'Not selected for this run',
    finishedAt: new Date(),
  })
  runEvents.publish(ctx.runId, { type: 'stage', data: toStreamStage(updatedStage) })

  const check = ctx.checks.get(spec.type)
  if (check) {
    const updatedCheck = await updateCheck(check.id, {
      status: 'skipped',
      message: 'Not selected for this run',
      finishedAt: new Date(),
    })
    await publishCheck(ctx.runId, updatedCheck)
  }

  const stages = await listRunStages(ctx.runId)
  publishProgress(ctx.runId, stages)
}

async function skipRemainingStages(runId: string, fromStage: RunStageKey): Promise<void> {
  const fromIndex = RUN_STAGE_ORDER.indexOf(fromStage)
  const rows = await listRunStages(runId)
  for (const row of rows) {
    const index = RUN_STAGE_ORDER.indexOf(row.stage)
    if (index < fromIndex) continue
    if (['passed', 'failed', 'skipped', 'error'].includes(row.status)) continue
    const updated = await updateRunStage(runId, row.stage, {
      status: 'skipped',
      message: 'Run cancelled',
      finishedAt: new Date(),
    })
    runEvents.publish(runId, { type: 'stage', data: toStreamStage(updated) })
  }

  const checkRows = await listChecksForRun(runId, { limit: 50, offset: 0 })
  for (const check of checkRows.rows) {
    if (check.status !== 'queued') continue
    const updated = await updateCheck(check.id, { status: 'skipped', message: 'Run cancelled', finishedAt: new Date() })
    await publishCheck(runId, updated)
  }
}

async function publishTerminal(runId: string): Promise<void> {
  const row = await findRunById(runId)
  if (!row) return
  const [stages, stats] = await Promise.all([listRunStages(runId), checkStatsForRun(runId)])
  const apiRun = toApiRun(row, stages, stats)
  runEvents.publish(runId, {
    type: 'status',
    data: { status: apiRun.status, healthScore: apiRun.healthScore },
  })
  publishProgress(runId, stages)
  runEvents.publish(runId, { type: 'done', data: apiRun })
}

/** Snapshot replayed to a client that subscribes mid-run. */
export async function streamSnapshot(run: RunRow): Promise<{
  events: RunStreamEvent[]
  stages: RunStageRow[]
}> {
  const stages = await listRunStages(run.id)
  const events: RunStreamEvent[] = []
  const apiStages = toApiStages(stages)
  events.push({
    type: 'status',
    data: { status: toApiRun(run, stages, null).status, healthScore: run.healthScore },
  })
  for (const stage of apiStages) {
    if (stage.status === 'queued') continue
    events.push({
      type: 'stage',
      data: {
        stage: stage.stage,
        status: stage.status,
        ...(stage.startedAt ? { startedAt: stage.startedAt } : {}),
        ...(stage.finishedAt ? { finishedAt: stage.finishedAt } : {}),
        ...(stage.message ? { message: stage.message } : {}),
      },
    })
  }
  const done = stages.filter((stage) => ['passed', 'failed', 'skipped', 'error'].includes(stage.status)).length
  events.push({ type: 'progress', data: { percent: Math.round((done / RUN_STAGE_ORDER.length) * 100) } })
  return { events, stages }
}
