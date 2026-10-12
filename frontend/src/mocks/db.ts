/**
 * In-memory mock database + run engine.
 * Runs "play" over a scripted timeline (~14s) and push events to SSE
 * subscribers, mirroring exactly what the real backend emits.
 */

import {
  buildChecks,
  buildCleanChecks,
  buildFindings,
  buildLoadTest,
  buildSeedWorld,
  commitsForOthers,
  makeStages,
  RERUN_FAILING_KEYS,
  simpleStructure,
  STORY_CHECK_SEEDS,
  STORY_FAILING_KEYS,
  type SeededWorld,
} from './data'
import type {
  Check,
  CheckStatus,
  LoadTestResult,
  Finding,
  Project,
  Run,
  RunStageKey,
  RunStageProgress,
  RunStatus,
  RunTrigger,
  StructureMap,
  User,
} from '../types/domain.types'
import { RUN_STAGE_ORDER } from '../types/domain.types'
import type { RunStreamEvent } from '../types/api.types'

/* -------------------------------------------------------------------------- */
/* State                                                                      */
/* -------------------------------------------------------------------------- */

export interface MockDbState extends SeededWorld {
  users: User[]
  currentUser: User | null
  loggedOut: boolean
}

function createDb(): MockDbState {
  const world = buildSeedWorld()
  return {
    ...world,
    commits: [...world.commits, ...commitsForOthers],
    users: [],
    currentUser: null,
    loggedOut: false,
  }
}

export const db: MockDbState = createDb()

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

export function isTerminal(status: RunStatus): boolean {
  return status === 'passed' || status === 'failed' || status === 'cancelled'
}

export function summaryOf(run: Run): Project['latestRun'] {
  return { id: run.id, status: run.status, healthScore: run.healthScore, startedAt: run.startedAt }
}

export function findRun(runId: string): Run | undefined {
  return db.runs.find((run) => run.id === runId)
}

export interface CreateRunOptions {
  trigger: RunTrigger
  loadUsers: number
  expectedChecks: number
  previousRunId?: string
  commitSha?: string
}

export function createRun(project: Project, options: CreateRunOptions): Run {
  return {
    id: newId('run'),
    projectId: project.id,
    projectName: project.name,
    status: 'queued',
    trigger: options.trigger,
    stages: makeStages(),
    healthScore: null,
    passedChecks: 0,
    failedChecks: 0,
    totalChecks: options.expectedChecks,
    startedAt: new Date().toISOString(),
    loadUsers: options.loadUsers,
    previousRunId: options.previousRunId,
    commitSha: options.commitSha,
  }
}

export const EXPECTED_STORY_CHECKS = STORY_CHECK_SEEDS.length
export const EXPECTED_CLEAN_CHECKS = 8

/* -------------------------------------------------------------------------- */
/* Run engine                                                                 */
/* -------------------------------------------------------------------------- */

export interface MockStreamHandlers {
  onOpen?: () => void
  onEvent: (event: RunStreamEvent) => void
  onError?: (error: Error) => void
  onClose: (finished: boolean) => void
}

export interface MockStreamHandle {
  close: () => void
}

export interface TimelineStep {
  at: number
  event: RunStreamEvent
  apply?: () => void
}

const engine = (() => {
  const timers = new Map<string, number[]>()
  const subscribers = new Map<string, Set<MockStreamHandlers>>()
  const eventLog = new Map<string, RunStreamEvent[]>()
  const finished = new Set<string>()

  function emit(runId: string, event: RunStreamEvent): void {
    eventLog.get(runId)?.push(event)
    const handlers = subscribers.get(runId)
    if (handlers) {
      for (const handler of [...handlers]) handler.onEvent(event)
    }
  }

  function stopTimers(runId: string): void {
    for (const timer of timers.get(runId) ?? []) window.clearTimeout(timer)
    timers.delete(runId)
  }

  function start(run: Run, steps: TimelineStep[]): void {
    eventLog.set(run.id, [])
    finished.delete(run.id)
    const ids = steps.map((step) =>
      window.setTimeout(() => {
        step.apply?.()
        emit(run.id, step.event)
        if (step.event.type === 'done') {
          finished.add(run.id)
          stopTimers(run.id)
        }
      }, step.at),
    )
    timers.set(run.id, ids)
  }

  function cancel(runId: string): Run | null {
    const run = findRun(runId)
    if (!run) return null
    if (isTerminal(run.status)) return run
    stopTimers(runId)
    const finishedAt = new Date().toISOString()
    run.status = 'cancelled'
    run.finishedAt = finishedAt
    run.durationMs = Math.max(0, Date.now() - new Date(run.startedAt).getTime())
    run.summary = 'Run cancelled by user before completion.'
    for (const stage of run.stages) {
      if (stage.status === 'running' || stage.status === 'queued') {
        stage.status = 'skipped'
        stage.finishedAt = finishedAt
      }
    }
    emit(runId, { type: 'status', data: { status: 'cancelled', healthScore: run.healthScore } })
    emit(runId, { type: 'done', data: run })
    finished.add(runId)
    const project = db.projects.find((item) => item.id === run.projectId)
    if (project) {
      project.latestRun = summaryOf(run)
      project.updatedAt = finishedAt
    }
    return run
  }

  function subscribe(runId: string, handlers: MockStreamHandlers): MockStreamHandle {
    const run = findRun(runId)
    if (!run) {
      window.setTimeout(() => {
        handlers.onError?.(new Error('Run not found'))
        handlers.onClose(false)
      }, 0)
      return { close: () => undefined }
    }

    const replay = eventLog.get(runId) ?? []
    for (const event of replay) handlers.onEvent(event)

    if (finished.has(runId) || isTerminal(run.status)) {
      if (!replay.some((event) => event.type === 'done')) {
        handlers.onEvent({ type: 'done', data: run })
      }
      handlers.onClose(true)
      return { close: () => undefined }
    }

    handlers.onOpen?.()
    let set = subscribers.get(runId)
    if (!set) {
      set = new Set()
      subscribers.set(runId, set)
    }
    set.add(handlers)
    return {
      close: () => {
        set?.delete(handlers)
      },
    }
  }

  return { start, cancel, subscribe }
})()

export function subscribeMockRunStream(runId: string, handlers: MockStreamHandlers): MockStreamHandle {
  return engine.subscribe(runId, handlers)
}

export function cancelMockRun(runId: string): Run | null {
  return engine.cancel(runId)
}

/* -------------------------------------------------------------------------- */
/* Timeline builders                                                          */
/* -------------------------------------------------------------------------- */

function stageOf(run: Run, key: RunStageKey): RunStageProgress {
  const stage = run.stages.find((item) => item.stage === key)
  if (!stage) throw new Error(`mock: stage ${key} missing`)
  return stage
}

function stageStep(run: Run, at: number, key: RunStageKey, status: CheckStatus, message?: string): TimelineStep {
  const stage = stageOf(run, key)
  return {
    at,
    event: { type: 'stage', data: { ...stage, status, message } },
    apply: () => {
      stage.status = status
      if (message !== undefined) stage.message = message
      if (status === 'running') stage.startedAt = new Date().toISOString()
      if (status === 'passed' || status === 'failed' || status === 'skipped') {
        stage.finishedAt = new Date().toISOString()
      }
    },
  }
}

function progressStep(at: number, percent: number): TimelineStep {
  return { at, event: { type: 'progress', data: { percent } } }
}

function checkStep(run: Run, at: number, check: Check): TimelineStep {
  return {
    at,
    event: { type: 'check', data: check },
    apply: () => {
      db.checks.push(check)
      if (check.status === 'passed') run.passedChecks += 1
      if (check.status === 'failed') run.failedChecks += 1
    },
  }
}

function findingStep(at: number, finding: Finding): TimelineStep {
  return {
    at,
    event: { type: 'finding', data: finding },
    apply: () => {
      db.findings.push(finding)
    },
  }
}

function loadStep(run: Run, at: number, load: LoadTestResult, persist = true): TimelineStep {
  return {
    at,
    event: { type: 'load', data: load },
    apply: persist
      ? () => {
          db.loadTests.set(run.id, load)
        }
      : undefined,
  }
}

function statusStep(run: Run, at: number, status: RunStatus, healthScore: number | null): TimelineStep {
  return {
    at,
    event: { type: 'status', data: { status, healthScore } },
    apply: () => {
      run.status = status
      if (healthScore !== null) run.healthScore = healthScore
    },
  }
}

interface DoneOptions {
  status: 'passed' | 'failed'
  healthScore: number
  durationMs: number
  summary: string
}

function doneStep(run: Run, at: number, options: DoneOptions): TimelineStep {
  return {
    at,
    event: { type: 'done', data: run },
    apply: () => {
      run.status = options.status
      run.healthScore = options.healthScore
      run.finishedAt = new Date().toISOString()
      run.durationMs = options.durationMs
      run.summary = options.summary
      const project = db.projects.find((item) => item.id === run.projectId)
      if (project) {
        project.latestRun = summaryOf(run)
        project.updatedAt = run.finishedAt
      }
    },
  }
}

function partialLoad(load: LoadTestResult, keepLevels: number): LoadTestResult {
  return {
    ...load,
    routes: load.routes.map((route) => ({
      ...route,
      levels: route.levels.slice(0, keepLevels),
      breakingPointUsers: undefined,
    })),
  }
}

/* ------------------------------- Story timeline ---------------------------- */

const STORY_FINDING_KEYS = [
  'admin-route-noauth',
  'service-list-404',
  'mapping-service-ids',
  'db-pool-100',
  'n1-bookings',
  'dep-express-cve',
  'intermittent-500',
]

const STORY_SCHEDULE: Array<[string, number]> = [
  ['struct-scan', 950],
  ['build-frontend', 1_200],
  ['lint-types', 1_300],
  ['jest-suite', 2_900],
  ['e2e-booking', 3_900],
  ['e2e-service-list', 4_700],
  ['api-bookings-crud', 4_900],
  ['api-contract-services', 5_300],
  ['data-probe', 6_400],
  ['mapping-validate', 7_100],
  ['migration-check', 8_300],
  ['db-n1', 8_700],
  ['db-pool-50', 9_100],
  ['load-bookings', 10_800],
  ['load-services', 11_300],
  ['load-post-bookings', 11_500],
  ['audit-deps', 12_500],
  ['authz-matrix', 13_000],
  ['headers-tls', 13_300],
  ['secrets-scan', 13_400],
  ['perf-budget', 13_550],
]

/** The demo run: reveals the full story (critical admin route, 404 call, mapping cluster, pool failure). */
export function buildStoryTimeline(run: Run): TimelineStep[] {
  const createdAt = new Date().toISOString()
  const checks = buildChecks(run.id, STORY_FAILING_KEYS, Date.now())
  const findings = buildFindings(run.id, run.projectId, STORY_FINDING_KEYS, createdAt)
  const load = buildLoadTest(run.id, createdAt, false)

  const pickCheck = (key: string): Check => {
    const check = checks.find((item) => item.id === `${run.id}_${key}`)
    if (!check) throw new Error(`mock: unknown check ${key}`)
    return check
  }
  const pickFinding = (key: string): Finding => {
    const finding = findings.find((item) => item.fingerprint === `fp.${key}`)
    if (!finding) throw new Error(`mock: unknown finding ${key}`)
    return finding
  }

  const steps: TimelineStep[] = [
    statusStep(run, 0, 'running', null),
    stageStep(run, 50, 'structure', 'running'),
    stageStep(run, 1_000, 'structure', 'passed'),
    stageStep(run, 1_100, 'existing_tests', 'running'),
    progressStep(1_200, 12),
    stageStep(run, 3_000, 'existing_tests', 'passed'),
    stageStep(run, 3_100, 'api_tests', 'running'),
    progressStep(3_200, 25),
    stageStep(run, 5_500, 'api_tests', 'failed', '2 of 7 checks failed'),
    progressStep(5_560, 38),
    stageStep(run, 5_600, 'data_fetch', 'running'),
    stageStep(run, 6_600, 'data_fetch', 'failed', 'GET /api/service-list probe returned 404'),
    progressStep(6_650, 46),
    stageStep(run, 6_700, 'mapping', 'running'),
    stageStep(run, 7_300, 'mapping', 'failed', '5 cases failed with 1 root cause'),
    progressStep(7_350, 58),
    stageStep(run, 7_400, 'database', 'running'),
    stageStep(run, 9_200, 'database', 'failed', 'N+1 on /api/bookings; pool OK at 50 users'),
    progressStep(9_250, 72),
    stageStep(run, 9_300, 'load', 'running'),
    progressStep(9_350, 78),
    loadStep(run, 10_200, partialLoad(load, 3), false),
    loadStep(run, 11_100, load),
    stageStep(run, 11_600, 'load', 'failed', 'Breaking point at 100 users (18.2% errors)'),
    progressStep(11_650, 90),
    stageStep(run, 11_700, 'security', 'running'),
    stageStep(run, 13_700, 'security', 'failed', '1 critical: unauthenticated admin route'),
    progressStep(13_750, 100),
    statusStep(run, 13_800, 'failed', 62),
    doneStep(run, 14_000, {
      status: 'failed',
      healthScore: 62,
      durationMs: 402_000,
      summary: '7 of 21 checks failed. 1 critical security issue, 3 high. AI produced 7 findings with evidence.',
    }),
  ]

  for (const [key, at] of STORY_SCHEDULE) {
    steps.push(checkStep(run, at, pickCheck(key)))
  }

  steps.push(
    findingStep(4_800, pickFinding('service-list-404')),
    findingStep(7_200, pickFinding('mapping-service-ids')),
    findingStep(8_800, pickFinding('n1-bookings')),
    findingStep(10_900, pickFinding('db-pool-100')),
    findingStep(12_550, pickFinding('dep-express-cve')),
    findingStep(13_100, pickFinding('admin-route-noauth')),
    findingStep(13_600, pickFinding('intermittent-500')),
  )

  return steps
}

/* ------------------------------- Rerun timeline ---------------------------- */

/** After the fixes: all critical/high issues resolved; 2 checks still failing, 1 new regression. */
export function buildRerunTimeline(run: Run): TimelineStep[] {
  const createdAt = new Date().toISOString()
  const checks = buildChecks(run.id, RERUN_FAILING_KEYS, Date.now())
  const findings = buildFindings(run.id, run.projectId, ['n1-bookings', 'intermittent-500', 'services-latency-regression'], createdAt)
  const load = buildLoadTest(run.id, createdAt, true)

  const pickCheck = (key: string): Check => {
    const check = checks.find((item) => item.id === `${run.id}_${key}`)
    if (!check) throw new Error(`mock: unknown check ${key}`)
    return check
  }
  const pickFinding = (key: string): Finding => {
    const finding = findings.find((item) => item.fingerprint === `fp.${key}`)
    if (!finding) throw new Error(`mock: unknown finding ${key}`)
    return finding
  }

  const n1 = pickFinding('n1-bookings')
  n1.comparisonStatus = 'still_failing'
  const intermittent = pickFinding('intermittent-500')
  intermittent.comparisonStatus = 'still_failing'
  const regression = pickFinding('services-latency-regression')
  regression.comparisonStatus = 'new'

  const steps: TimelineStep[] = [
    statusStep(run, 0, 'running', null),
    stageStep(run, 50, 'structure', 'running'),
    stageStep(run, 1_000, 'structure', 'passed'),
    stageStep(run, 1_100, 'existing_tests', 'running'),
    progressStep(1_200, 12),
    stageStep(run, 3_000, 'existing_tests', 'passed'),
    stageStep(run, 3_100, 'api_tests', 'running'),
    progressStep(3_200, 25),
    stageStep(run, 5_500, 'api_tests', 'passed', 'All 7 checks green — service-list 404 resolved'),
    progressStep(5_560, 38),
    stageStep(run, 5_600, 'data_fetch', 'running'),
    stageStep(run, 6_600, 'data_fetch', 'passed'),
    progressStep(6_650, 46),
    stageStep(run, 6_700, 'mapping', 'running'),
    stageStep(run, 7_300, 'mapping', 'passed', 'All 5 mapping cases green'),
    progressStep(7_350, 58),
    stageStep(run, 7_400, 'database', 'running'),
    stageStep(run, 9_200, 'database', 'failed', 'N+1 still present on /api/bookings'),
    progressStep(9_250, 72),
    stageStep(run, 9_300, 'load', 'running'),
    progressStep(9_350, 78),
    loadStep(run, 10_200, partialLoad(load, 3), false),
    loadStep(run, 11_100, load),
    stageStep(run, 11_600, 'load', 'passed', 'No breaking point up to 100 users — pool fix verified'),
    progressStep(11_650, 90),
    stageStep(run, 11_700, 'security', 'running'),
    stageStep(run, 13_700, 'security', 'passed', 'Admin route now returns 401; express advisory fixed'),
    progressStep(13_750, 100),
    statusStep(run, 13_800, 'failed', 84),
    doneStep(run, 14_000, {
      status: 'failed',
      healthScore: 84,
      durationMs: 361_000,
      summary: '2 of 21 checks still failing. Previous critical and high findings verified fixed. 1 new low-severity regression.',
    }),
  ]

  for (const [key, at] of STORY_SCHEDULE) {
    steps.push(checkStep(run, at, pickCheck(key)))
  }

  steps.push(
    findingStep(8_800, n1),
    findingStep(13_600, intermittent),
    findingStep(13_650, regression),
  )

  return steps
}

/* ------------------------------- Clean timeline ---------------------------- */

/** Used for sample projects (and newly created ones): everything passes. */
export function buildCleanTimeline(run: Run): TimelineStep[] {
  const checks = buildCleanChecks(run.id, Date.now())
  const steps: TimelineStep[] = [statusStep(run, 0, 'running', null)]
  let t = 100

  RUN_STAGE_ORDER.forEach((stageKey, index) => {
    steps.push(stageStep(run, t, stageKey, 'running'))
    const check = checks[index]
    if (check) steps.push(checkStep(run, t + 500, check))
    steps.push(stageStep(run, t + 900, stageKey, 'passed'))
    steps.push(progressStep(t + 950, Math.round(((index + 1) / RUN_STAGE_ORDER.length) * 100)))
    t += 1_000
  })

  const load = buildLoadTest(run.id, new Date().toISOString(), true)
  steps.push(loadStep(run, t + 200, load))
  steps.push(
    doneStep(run, t + 400, {
      status: 'passed',
      healthScore: 92,
      durationMs: 184_000,
      summary: 'All 8 checks passed. No findings.',
    }),
  )
  return steps
}

/* ------------------------------- Start helpers ------------------------------ */

export function startRunTimeline(run: Run, kind: 'story' | 'rerun' | 'clean'): void {
  const timeline =
    kind === 'story' ? buildStoryTimeline(run) : kind === 'rerun' ? buildRerunTimeline(run) : buildCleanTimeline(run)
  engine.start(run, timeline)
}

export function structureFor(projectId: string): StructureMap {
  return db.structure.get(projectId) ?? simpleStructure()
}

export function artifactsForRun(runId: string): string[] {
  const run = findRun(runId)
  if (!run) return []
  const artifactIds = db.checks.filter((check) => check.runId === runId).flatMap((check) => check.artifactIds)
  return [...new Set(artifactIds)]
}
