/**
 * Seed data + builders for the mock backend.
 * Story: "booking-app" — an Express/React booking platform whose latest
 * verification run found 1 Critical, 3 High, 1 Medium and 2 Low findings.
 */

import type {
  Artifact,
  Check,
  CheckStatus,
  CheckType,
  Commit,
  DetectedStack,
  DiffEvidence,
  Finding,
  FindingCategory,
  HttpEvidence,
  LoadLevelResult,
  LoadTestResult,
  LogEvidence,
  Project,
  RouteLoadResult,
  Run,
  RunStageProgress,
  ScreenshotEvidence,
  Severity,
  StructureMap,
  User,
  UserSettings,
} from '../types/domain.types'
import { RUN_STAGE_ORDER } from '../types/domain.types'

/* ------------------------------- Time helpers ------------------------------ */

const now = Date.now()
const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

export const iso = (msAgo: number): string => new Date(now - msAgo).toISOString()

/* ---------------------------------- Users ---------------------------------- */

export const seedUsers: User[] = [
  {
    id: 'u_varun',
    email: 'varun@acme.dev',
    name: 'Varun Sharma',
    role: 'admin',
    createdAt: iso(400 * DAY),
  },
  {
    id: 'u_maya',
    email: 'maya@acme.dev',
    name: 'Maya Chen',
    role: 'user',
    createdAt: iso(300 * DAY),
  },
  {
    id: 'u_ravi',
    email: 'ravi@acme.dev',
    name: 'Ravi Patel',
    role: 'user',
    createdAt: iso(120 * DAY),
  },
]

/* ------------------------------ Stack & settings ---------------------------- */

const bookingStack: DetectedStack = {
  language: 'TypeScript',
  framework: 'Express',
  runtime: 'Node 20',
  database: 'PostgreSQL 15',
  packageManager: 'npm',
  frontend: 'React 18 + Vite',
  testFrameworks: ['Jest', 'Supertest', 'Playwright', 'k6'],
  dependencies: ['express', 'pg', 'zod', 'react', 'react-router-dom', 'axios', 'dayjs'],
}

const paymentsStack: DetectedStack = {
  language: 'Go',
  framework: 'Fiber',
  runtime: 'Go 1.22',
  database: 'PostgreSQL 15',
  packageManager: 'go modules',
  testFrameworks: ['go test', 'k6'],
  dependencies: ['fiber', 'pgx', 'zap'],
}

const webDashStack: DetectedStack = {
  language: 'TypeScript',
  framework: 'Next.js',
  runtime: 'Node 20',
  database: 'PostgreSQL 15',
  packageManager: 'pnpm',
  frontend: 'Next.js 14 App Router',
  testFrameworks: ['Vitest', 'Playwright'],
  dependencies: ['next', 'react', 'prisma', 'tailwindcss', 'zod'],
}

const mobileApiStack: DetectedStack = {
  language: 'TypeScript',
  framework: 'Fastify',
  runtime: 'Node 20',
  database: 'PostgreSQL 15',
  packageManager: 'npm',
  testFrameworks: ['Vitest'],
  dependencies: ['fastify', 'pg', 'zod'],
}

const defaultSettings: UserSettings = {
  defaultLoadUsers: 50,
  errorRateThresholdPct: 5,
  p95ThresholdMs: 800,
}

/* --------------------------------- Runs IDs -------------------------------- */

export const RUN_IDS = {
  bookingLatest: 'run_9f3k2c',
  bookingPrev: 'run_7b41de',
  bookingMid: 'run_5c02aa',
  bookingOld: 'run_3f8c17',
  bookingPass1: 'run_21d9e0',
  bookingPass2: 'run_18c47b',
  paymentsLatest: 'run_e1a934',
  paymentsPrev: 'run_d2207f',
  webDashLatest: 'run_b7c315',
} as const

export const ART = {
  structure: 'art_structure',
  jestLog: 'art_jest_log',
  pwLog: 'art_pw_log',
  supertestLog: 'art_supertest_log',
  probeLog: 'art_probe_log',
  mappingLog: 'art_mapping_log',
  dbLog: 'art_db_log',
  n1Log: 'art_n1_log',
  k6Log: 'art_k6_log',
  k6Summary: 'art_k6_summary',
  auditLog: 'art_audit_log',
  authzLog: 'art_authz_log',
  headersLog: 'art_headers_log',
  secretsLog: 'art_secrets_log',
} as const

export const ADMIN_SCREENSHOT_URL = '/mock/admin-unauthenticated.png'

/* ------------------------------- Artifacts --------------------------------- */

interface ArtifactSeed {
  name: string
  kind: Artifact['kind']
  sizeBytes: number
  content?: string
  url?: string
}

const jestLog = `PASS tests/bookings.spec.ts (6.2s)
PASS tests/services.spec.ts (4.1s)
PASS tests/auth.spec.ts (3.8s)
PASS tests/mappers.spec.ts (2.2s)

Test Suites: 12 passed, 12 total
Tests:       28 passed, 28 total
Snapshots:   0 total
Time:        42.1s`

const pwLog = `Running 5 tests using 2 workers

  ✓ tests/e2e/booking.spec.ts:14 booking flow creates a reservation (6.1s)
  ✘ tests/e2e/service-list.spec.ts:9 service list page renders (12.9s)

  1) tests/e2e/service-list.spec.ts:9:1 › service list page renders
    Error: expect(received).toBe(expected)

    Expected status: 200
    Received status: 404 for GET http://localhost:3000/api/service-list

    at ServiceListPage.waitForServices (src/pages/ServiceListPage.tsx:38:24)
    at tests/e2e/service-list.spec.ts:23:5

  4 passed, 1 failed (1m 12s)`

const probeLog = `Probing 9 endpoints discovered from frontend usage...

  GET  /api/bookings       200  142ms
  GET  /api/services       200   88ms
  POST /api/auth/login     200  210ms
  GET  /api/users/me       200   64ms
  GET  /api/service-list   ✖ 404   23ms   <- called from src/pages/ServiceListPage.tsx but not exposed by the API
  GET  /api/admin/users    200   91ms   (no token required!)

2 mismatches found. See mapping report.`

const mappingLog = `Field mapping verification — frontend types vs API payloads

  case 1  ServiceListPage -> ServiceCard       FAIL  expected "serviceId", received "service_id"
  case 2  BookingForm     -> ServiceSelect     FAIL  expected "serviceId", received "service_id"
  case 3  BookingSummary  -> ServiceBadge      FAIL  expected "serviceId", received "service_id"
  case 4  AdminServices   -> ServiceTable      FAIL  expected "serviceId", received "service_id"
  case 5  useServices()   -> query cache key   FAIL  expected "serviceId", received "service_id"

  5 failures, 1 root cause: src/mappers/service.mapper.ts:18 does not normalize
  snake_case database columns into camelCase frontend models.`

const dbLog = `Schema drift check .... 6 tables match migrations
Pending migrations .... 0
Foreign keys .......... 12 valid

Pool probe @ 50 users
  pool max ............. 10
  peak connections ..... 10/10
  waiting requests ..... 0
  p95 checkout time .... 4ms
  verdict .............. OK at 50 users`

const n1Log = `Query audit — endpoints exceeding the query budget (10/request)

  GET /api/bookings
    queries per request .... 41  (budget: 10)  FAIL
    pattern ................ SELECT * FROM services WHERE id = $1  x 40
    source ................. src/repositories/booking.repo.ts:63
    suggestion ............. join services in the bookings query or batch-load by id set

  GET /api/users/me ..... 3 queries   PASS`

const k6Log = `k6 run load/bookings.js --ramp 1,10,50,100

          /\\      |‾‾| /‾‾/   /‾‾/
     /\\  /  \\     |  |/  /   /  /
    /  \\/    \\    |     (   /   ‾‾\\
   /          \\   |  |\\  \\ |  (‾)  |
  / __________ \\  |__| \\__\\ \\_____/ .io

scenarios: (3)  max VUs: 100  duration: 45s

     ✓ GET /api/bookings @ 1 user     p95=61ms    err=0.0%
     ✓ GET /api/bookings @ 10 users   p95=84ms    err=0.0%
     ✓ GET /api/bookings @ 50 users   p95=148ms   err=0.4%
     ✗ GET /api/bookings @ 100 users  p95=4220ms  err=18.2%

FATAL: remaining connection slots are reserved for non-replication superuser connections
(pg pool exhausted — pool.max=10, 100 concurrent users)

thresholds: http_req_failed{route:/api/bookings} rate<0.05 -> FAIL
            http_req_duration{route:/api/bookings} p(95)<800 -> FAIL`

const auditLog = `npm audit --audit-level=high --json

  2 vulnerabilities found

  HIGH    express  <4.17.3
          CVE-2022-24999  qs prototype pollution via crafted query string
          fix available: express@4.21.0 (breaking changes: none)
          range: >=4.16.0 <4.17.3

  MODERATE cookie  <0.7.0
          GHSA-pxg6-pf52-xh8x  out-of-bounds characters
          fix available via npm audit fix (transitive)

  No exploits observed at runtime — flagged from static advisory matching only.`

const authzLog = `Route authorization matrix — unauthenticated probes

  GET  /api/services         200  public            OK
  GET  /api/bookings         401  requires user     OK
  GET  /api/users/me         401  requires user     OK
  POST /api/admin/seed       200  NO TOKEN REQUIRED ✖
  GET  /api/admin/users      200  NO TOKEN REQUIRED ✖

  response sample (GET /api/admin/users, no Authorization header):
  {"users":[{"id":"u_1","email":"maya@acme.dev","role":"user"}, ... 8 rows]}

  No auth middleware found on router mounted at /api/admin in
  src/routes/admin.routes.ts:12`

const headersLog = `OWASP secure headers baseline
  content-security-policy ..... present (report-only)
  x-frame-options ............. DENY
  strict-transport-security ... max-age=31536000
  x-content-type-options ...... nosniff
  TLS ......................... 1.2+ enforced`

const secretsLog = `gitleaks detect --no-banner
  commits scanned ....... 1,204
  secrets found ......... 0
  working tree .......... clean`

const structureLog = `Scanned 214 files in 4.1s
  routes ............. 12
  db tables .......... 6
  components ......... 12
  frontend api calls . 9
Report written to structure.json`

export const artifactCatalog: Record<string, ArtifactSeed> = {
  [ART.structure]: { name: 'structure.json', kind: 'report', sizeBytes: 18_442, content: structureLog },
  [ART.jestLog]: { name: 'jest.log', kind: 'log', sizeBytes: 2_104, content: jestLog },
  [ART.pwLog]: { name: 'playwright.log', kind: 'log', sizeBytes: 4_512, content: pwLog },
  [ART.supertestLog]: {
    name: 'supertest.log',
    kind: 'log',
    sizeBytes: 1_820,
    content: `API tests: 31 passed, 0 failed\n  bookings CRUD ..... 9 passed\n  services schema ... 7 passed\n  auth matrix ....... 15 passed`,
  },
  [ART.probeLog]: { name: 'endpoint-probe.log', kind: 'log', sizeBytes: 1_042, content: probeLog },
  [ART.mappingLog]: { name: 'mapping-cases.log', kind: 'log', sizeBytes: 2_260, content: mappingLog },
  [ART.dbLog]: { name: 'database.log', kind: 'log', sizeBytes: 3_440, content: dbLog },
  [ART.n1Log]: { name: 'query-audit.log', kind: 'log', sizeBytes: 1_650, content: n1Log },
  [ART.k6Log]: { name: 'k6-bookings.log', kind: 'log', sizeBytes: 9_880, content: k6Log },
  [ART.k6Summary]: {
    name: 'k6-summary.json',
    kind: 'report',
    sizeBytes: 5_120,
    content: '{\n  "GET /api/bookings": { "p95_ms": 4220, "error_rate": 0.182, "breaking_point_users": 100 }\n}',
  },
  [ART.auditLog]: { name: 'npm-audit.log', kind: 'log', sizeBytes: 2_940, content: auditLog },
  [ART.authzLog]: { name: 'authz-matrix.log', kind: 'log', sizeBytes: 3_120, content: authzLog },
  [ART.headersLog]: { name: 'headers-baseline.log', kind: 'log', sizeBytes: 640, content: headersLog },
  [ART.secretsLog]: { name: 'secret-scan.log', kind: 'log', sizeBytes: 410, content: secretsLog },
}

export function buildArtifact(runId: string, artifactId: string, createdAt: string): Artifact | null {
  const seed = artifactCatalog[artifactId]
  if (!seed) return null
  return { id: artifactId, runId, name: seed.name, kind: seed.kind, sizeBytes: seed.sizeBytes, createdAt }
}

/* --------------------------------- Checks ---------------------------------- */

interface CheckSeed {
  key: string
  name: string
  type: CheckType
  command: string
  durationMs: number
  artifactIds: string[]
  message?: string
}

export const STORY_CHECK_SEEDS: CheckSeed[] = [
  { key: 'struct-scan', name: 'Architecture & structure scan', type: 'api', command: 'proofloop scan --structure --emit structure.json', durationMs: 4_120, artifactIds: [ART.structure] },
  { key: 'jest-suite', name: 'Existing test suite (Jest + Supertest)', type: 'api', command: 'npm test -- --ci --silent', durationMs: 42_100, artifactIds: [ART.jestLog] },
  { key: 'e2e-booking', name: 'E2E: booking flow (Playwright)', type: 'e2e', command: 'npx playwright test tests/e2e/booking.spec.ts', durationMs: 38_210, artifactIds: [ART.pwLog] },
  { key: 'e2e-service-list', name: 'E2E: service list page renders', type: 'e2e', command: 'npx playwright test tests/e2e/service-list.spec.ts', durationMs: 12_980, artifactIds: [ART.pwLog], message: 'Expected 200 for GET /api/service-list, received 404' },
  { key: 'api-bookings-crud', name: 'API tests: /api/bookings CRUD', type: 'api', command: 'supertest run tests/api/bookings.spec.ts', durationMs: 21_040, artifactIds: [ART.supertestLog] },
  { key: 'api-contract-services', name: 'API contract: /api/services schema', type: 'api', command: 'supertest run tests/api/contract.services.spec.ts', durationMs: 9_860, artifactIds: [ART.supertestLog] },
  { key: 'data-probe', name: 'Data fetch: probe all frontend endpoints', type: 'api', command: 'proofloop probe --from structure.json', durationMs: 8_420, artifactIds: [ART.probeLog], message: 'GET /api/service-list returned 404' },
  { key: 'mapping-validate', name: 'Field mapping: frontend ↔ API (5 cases)', type: 'api', command: 'proofloop verify-mapping --cases 5', durationMs: 6_240, artifactIds: [ART.mappingLog], message: '5 cases failed with 1 shared root cause' },
  { key: 'migration-check', name: 'Migrations + schema drift', type: 'db', command: 'npm run db:check', durationMs: 9_410, artifactIds: [ART.dbLog] },
  { key: 'db-n1', name: 'Query audit: N+1 detector (top 20 endpoints)', type: 'db', command: 'proofloop audit-queries --top 20', durationMs: 11_200, artifactIds: [ART.n1Log], message: '41 queries per request on GET /api/bookings (budget 10)' },
  { key: 'db-pool-50', name: 'Connection pool probe @ 50 users', type: 'db', command: 'proofloop pool-probe --users 50', durationMs: 15_210, artifactIds: [ART.dbLog] },
  { key: 'load-bookings', name: 'Load test: GET /api/bookings (1→100 users)', type: 'load', command: 'k6 run load/bookings.js --ramp 1,10,50,100', durationMs: 45_210, artifactIds: [ART.k6Log, ART.k6Summary], message: 'p95 4.2s and 18.2% errors at 100 users' },
  { key: 'load-services', name: 'Load test: GET /api/services (1→100 users)', type: 'load', command: 'k6 run load/services.js --ramp 1,10,50,100', durationMs: 41_880, artifactIds: [ART.k6Log] },
  { key: 'load-post-bookings', name: 'Load test: POST /api/bookings (1→100 users)', type: 'load', command: 'k6 run load/create-booking.js --ramp 1,10,50,100', durationMs: 43_890, artifactIds: [ART.k6Log], message: 'p95 5.2s at 100 users — above latency budget, under error threshold' },
  { key: 'audit-deps', name: 'Dependency audit (npm audit --audit-level=high)', type: 'security', command: 'npm audit --audit-level=high --json', durationMs: 18_240, artifactIds: [ART.auditLog], message: '1 high vulnerability (express <4.17.3)' },
  { key: 'authz-matrix', name: 'Route authorization matrix (unauthenticated probes)', type: 'security', command: 'proofloop authz --routes all --no-token', durationMs: 22_410, artifactIds: [ART.authzLog], message: '/api/admin/* reachable without a token' },
  { key: 'headers-tls', name: 'Security headers + TLS baseline', type: 'security', command: 'proofloop headers --baseline owasp', durationMs: 2_410, artifactIds: [ART.headersLog] },
  { key: 'secrets-scan', name: 'Secret scan (git history + working tree)', type: 'security', command: 'gitleaks detect --no-banner', durationMs: 18_820, artifactIds: [ART.secretsLog] },
  { key: 'build-frontend', name: 'Frontend production build', type: 'e2e', command: 'npm run build', durationMs: 61_240, artifactIds: [] },
  { key: 'lint-types', name: 'Type check + lint gates', type: 'api', command: 'npm run typecheck && npm run lint', durationMs: 27_400, artifactIds: [] },
  { key: 'perf-budget', name: 'Performance regression budget (p95 delta vs last run)', type: 'load', command: 'proofloop perf-budget --baseline previous', durationMs: 3_120, artifactIds: [] },
]

export const STORY_FAILING_KEYS = [
  'e2e-service-list',
  'data-probe',
  'mapping-validate',
  'db-n1',
  'load-bookings',
  'audit-deps',
  'authz-matrix',
] as const

export const RERUN_FAILING_KEYS = ['db-n1', 'perf-budget'] as const

export function buildChecks(
  runId: string,
  failingKeys: readonly string[],
  startedAtMs: number,
): Check[] {
  return STORY_CHECK_SEEDS.map((seed, index) => {
    const failed = failingKeys.includes(seed.key)
    return {
      id: `${runId}_${seed.key}`,
      runId,
      name: seed.name,
      type: seed.type,
      command: seed.command,
      status: failed ? 'failed' : 'passed',
      exitCode: failed ? 1 : 0,
      durationMs: seed.durationMs,
      artifactIds: seed.artifactIds,
      message: seed.message,
      // spread check start times so history tables look organic
      createdAt: new Date(startedAtMs + index * 9_000).toISOString(),
    } satisfies Check
  })
}

const CLEAN_CHECK_SEEDS: CheckSeed[] = [
  { key: 'struct-scan', name: 'Architecture & structure scan', type: 'api', command: 'proofloop scan --structure', durationMs: 3_400, artifactIds: [ART.structure] },
  { key: 'unit-suite', name: 'Existing test suite', type: 'api', command: 'npm test -- --ci', durationMs: 28_900, artifactIds: [ART.jestLog] },
  { key: 'api-tests', name: 'API integration tests', type: 'api', command: 'npm run test:api', durationMs: 16_200, artifactIds: [ART.supertestLog] },
  { key: 'e2e-suite', name: 'E2E smoke suite', type: 'e2e', command: 'npm run test:e2e', durationMs: 44_100, artifactIds: [ART.pwLog] },
  { key: 'migration-check', name: 'Migrations + schema drift', type: 'db', command: 'npm run db:check', durationMs: 7_800, artifactIds: [ART.dbLog] },
  { key: 'load-50', name: 'Load test: key routes @ 50 users', type: 'load', command: 'k6 run load/smoke.js', durationMs: 32_400, artifactIds: [ART.k6Log] },
  { key: 'audit-deps', name: 'Dependency audit', type: 'security', command: 'npm audit --audit-level=high', durationMs: 9_100, artifactIds: [ART.auditLog] },
  { key: 'headers-tls', name: 'Security headers + TLS baseline', type: 'security', command: 'proofloop headers --baseline owasp', durationMs: 2_100, artifactIds: [ART.headersLog] },
]

export function buildCleanChecks(runId: string, startedAtMs: number): Check[] {
  return CLEAN_CHECK_SEEDS.map((seed, index) => ({
    id: `${runId}_${seed.key}`,
    runId,
    name: seed.name,
    type: seed.type,
    command: seed.command,
    status: 'passed' as CheckStatus,
    exitCode: 0,
    durationMs: seed.durationMs,
    artifactIds: seed.artifactIds,
    message: seed.message,
    createdAt: new Date(startedAtMs + index * 7_000).toISOString(),
  }))
}

/* --------------------------------- Findings -------------------------------- */

export interface FindingSeed {
  key: string
  severity: Severity
  category: FindingCategory
  title: string
  description: string
  filePath?: string
  line?: number
  endpoint?: string
  table?: string
  clusterId?: string
  clusterSize?: number
  confidence: number
  evidenceValidated: boolean
  evidence: Finding['evidence']
  whyItMatters: string
  howToFix: string[]
  notTested: string[]
}

const adminEvidenceHttp: HttpEvidence = {
  kind: 'http',
  title: 'Unauthenticated request — full admin user list returned',
  method: 'GET',
  url: '/api/admin/users',
  requestHeaders: { Host: 'api.booking-app.dev', 'User-Agent': 'k6/0.49', Accept: 'application/json' },
  status: 200,
  statusText: 'OK',
  responseBody:
    '{\n  "users": [\n    { "id": "u_1", "email": "maya@acme.dev", "role": "user", "created_at": "2025-03-04" },\n    { "id": "u_2", "email": "ravi@acme.dev", "role": "user", "created_at": "2025-05-19" },\n    ... 6 more rows\n  ],\n  "total": 8\n}',
  durationMs: 91,
}

const adminEvidenceScreenshot: ScreenshotEvidence = {
  kind: 'screenshot',
  title: 'Recorded probe — no Authorization header sent',
  url: ADMIN_SCREENSHOT_URL,
  caption: 'Automated probe captured the response from GET /api/admin/users with no token.',
}

const adminEvidenceLog: LogEvidence = {
  kind: 'log',
  title: 'authz-matrix.log (excerpt)',
  content: authzLog,
  language: 'text',
}

const adminEvidenceDiff: DiffEvidence = {
  kind: 'diff',
  title: 'Suggested change',
  filePath: 'src/routes/admin.routes.ts',
  diff: `--- a/src/routes/admin.routes.ts
+++ b/src/routes/admin.routes.ts
@@ -1,9 +1,10 @@
 import { Router } from 'express'
 import { listUsers, seedDemoData } from '../controllers/admin.controller'
+import { requireAuth, requireRole } from '../middleware/auth'
 
 const router = Router()
 
-// TODO: add auth before enabling in production
-router.get('/users', listUsers)
+router.use(requireAuth, requireRole('admin'))
+router.get('/users', listUsers)
 router.post('/seed', seedDemoData)
 
 export default router`,
}

const serviceListEvidenceHttp: HttpEvidence = {
  kind: 'http',
  title: 'The call the frontend makes',
  method: 'GET',
  url: '/api/service-list',
  requestHeaders: { Host: 'api.booking-app.dev', Accept: 'application/json', Referer: 'http://localhost:3000/services' },
  status: 404,
  statusText: 'Not Found',
  responseBody: '{\n  "error": "Not Found",\n  "message": "Route GET /api/service-list does not exist"\n}',
  durationMs: 23,
}

const serviceListEvidenceLog: LogEvidence = {
  kind: 'log',
  title: 'playwright.log (excerpt)',
  content: `  1) tests/e2e/service-list.spec.ts:9:1 › service list page renders
    Error: expect(received).toBe(expected)

    Expected status: 200
    Received status: 404 for GET http://localhost:3000/api/service-list

    at ServiceListPage.waitForServices (src/pages/ServiceListPage.tsx:38:24)`,
  language: 'text',
}

const serviceListEvidenceDiff: DiffEvidence = {
  kind: 'diff',
  title: 'Suggested change',
  filePath: 'src/api/services.ts',
  diff: `--- a/src/api/services.ts
+++ b/src/api/services.ts
@@ -41,7 +41,7 @@ export async function fetchUserBookings(userId: string) {
 }
 
 export async function fetchServiceList() {
-  const { data } = await api.get('/service-list')
+  const { data } = await api.get('/services')
   return data.map(normalizeService)
 }
`,
}

const mappingEvidenceLog: LogEvidence = {
  kind: 'log',
  title: '5 failing cases with shared root cause',
  content: mappingLog,
  language: 'text',
}

const mappingEvidenceHttp: HttpEvidence = {
  kind: 'http',
  title: 'API payload (snake_case)',
  method: 'GET',
  url: '/api/services',
  status: 200,
  statusText: 'OK',
  responseBody:
    '{\n  "services": [\n    {\n      "id": 12,\n      "name": "Deep tissue massage",\n      "service_id": "svc_12",   <- frontend expects "serviceId"\n      "price_cents": 8900,\n      "duration_min": 60\n    }\n  ]\n}',
  durationMs: 88,
}

const mappingEvidenceDiff: DiffEvidence = {
  kind: 'diff',
  title: 'Normalize at the mapper boundary',
  filePath: 'src/mappers/service.mapper.ts',
  diff: `--- a/src/mappers/service.mapper.ts
+++ b/src/mappers/service.mapper.ts
@@ -15,7 +15,9 @@ interface ApiService {
 }
 
 export function mapService(api: ApiService): Service {
   return {
-    id: api.service_id,
+    serviceId: api.service_id,
+    priceCents: api.price_cents,
+    durationMin: api.duration_min,
   }
 }`,
}

const poolEvidenceLog: LogEvidence = {
  kind: 'log',
  title: 'k6 tail — errors start exactly at 100 users',
  content: `time="14:02:41" level=warning msg="request failed" error="dial tcp 10.0.3.12:5432: connect: connection refused" route=GET /api/bookings vus=100
time="14:02:41" level=error   msg="FATAL: remaining connection slots are reserved for non-replication superuser connections" pool_max=10 waiting=90
...
checks_total....... 96,120   2140.8/s
http_req_failed..... 18.2%    (17,489 failures)
http_req_duration... p(50)=2.41s p(95)=4.22s p(99)=6.11s`,
  language: 'text',
}

const poolEvidenceHttp: HttpEvidence = {
  kind: 'http',
  title: 'Representative failure at 100 users',
  method: 'GET',
  url: '/api/bookings?from=2026-10-12&to=2026-10-19',
  status: 500,
  statusText: 'Internal Server Error',
  responseBody: '{\n  "error": "DatabaseUnavailable",\n  "message": "timeout exceeded when trying to connect"\n}',
  durationMs: 2410,
}

const n1EvidenceLog: LogEvidence = {
  kind: 'log',
  title: 'query-audit.log',
  content: n1Log,
  language: 'text',
}

const depEvidenceLog: LogEvidence = {
  kind: 'log',
  title: 'npm-audit.log',
  content: auditLog,
  language: 'text',
}

const unexplainedEvidenceLog: LogEvidence = {
  kind: 'log',
  title: 'The only trace we captured',
  content: `time="14:01:57" level=error msg="booking creation failed" error="unexpected write conflict" request_id=7f31aa status=500
(no further occurrences in 45,000 requests; retry with identical payload succeeded)`,
  language: 'text',
}

const latencyEvidenceLog: LogEvidence = {
  kind: 'log',
  title: 'Performance budget — p95 delta vs 7-day baseline',
  content: `route: GET /api/services @ 100 users
  baseline (7d) ...... 120ms
  current ............ 180ms   (+50.0%)   BUDGET_EXCEEDED (allowed: ±25%)
  error rate ......... 0.2%    OK
  absolute budget .... 800ms   OK

Note: absolute values are healthy. This is a trend regression, not an outage.`,
  language: 'text',
}

export const FINDING_SEEDS: FindingSeed[] = [
  {
    key: 'admin-route-noauth',
    severity: 'critical',
    category: 'security',
    title: 'Admin API is reachable without authentication',
    description:
      'GET /api/admin/users and POST /api/admin/seed returned 200 to unauthenticated probes. The /api/admin router in src/routes/admin.routes.ts is mounted without any auth middleware, so every admin endpoint is public.',
    filePath: 'src/routes/admin.routes.ts',
    line: 12,
    endpoint: 'GET /api/admin/users',
    confidence: 0.96,
    evidenceValidated: true,
    evidence: [adminEvidenceHttp, adminEvidenceScreenshot, adminEvidenceLog, adminEvidenceDiff],
    whyItMatters:
      'Anyone on the internet can enumerate every user account and trigger demo-data seeding. This is the highest-severity class of bug: no exploit tooling is needed, a browser tab is enough.',
    howToFix: [
      'Import requireAuth and requireRole from src/middleware/auth.ts.',
      'Apply router.use(requireAuth, requireRole("admin")) at the top of the admin router (see suggested diff).',
      'Add a supertest case asserting 401 for GET /api/admin/users without a token and 403 with a non-admin token.',
      'Re-run verification to prove the route now rejects anonymous requests.',
    ],
    notTested: [
      'Whether an admin-scoped token has broader access than intended (role escalation via query params)',
      'Audit logging of admin access',
      'Rate limiting on /api/admin/*',
    ],
  },
  {
    key: 'service-list-404',
    severity: 'high',
    category: 'api',
    title: 'Frontend calls GET /api/service-list, backend returns 404',
    description:
      'The service list page requests /api/service-list, but the backend exposes /api/services. Every render of the page fails its data fetch; the Playwright E2E test reproduces it deterministically.',
    filePath: 'src/api/services.ts',
    line: 44,
    endpoint: 'GET /api/service-list',
    confidence: 0.93,
    evidenceValidated: true,
    evidence: [serviceListEvidenceHttp, serviceListEvidenceLog, serviceListEvidenceDiff],
    whyItMatters:
      'The services catalog is the entry point of the booking flow. Until this is fixed the page is a permanent skeleton screen in production.',
    howToFix: [
      'Point the client call at /api/services (see suggested diff) or add an alias route on the backend.',
      'Keep the E2E service-list spec in CI so the contract cannot silently regress again.',
      'Re-run verification to confirm the E2E check passes.',
    ],
    notTested: ['Legacy clients that may still depend on /api/service-list', 'Server-side redirects for retired paths'],
  },
  {
    key: 'mapping-service-ids',
    severity: 'high',
    category: 'mapping',
    title: 'Field mapping mismatch: frontend expects serviceId, API returns service_id',
    description:
      'The API returns snake_case columns (service_id, price_cents, duration_min) while frontend models expect camelCase. mapService does not rename the field, so serviceId is undefined everywhere it is consumed. Five separate test cases fail, all with this single root cause.',
    filePath: 'src/mappers/service.mapper.ts',
    line: 18,
    clusterId: 'cl_8a12',
    clusterSize: 5,
    confidence: 0.91,
    evidenceValidated: true,
    evidence: [mappingEvidenceLog, mappingEvidenceHttp, mappingEvidenceDiff],
    whyItMatters:
      'Undefined serviceId breaks selection, keying and dedupe logic across the catalog and the booking form — 5 failing cases trace back to this one line.',
    howToFix: [
      'Map service_id into serviceId inside mapService (single boundary, not 5 call sites).',
      'Normalize price_cents and duration_min at the same time.',
      'Add a contract test that asserts camelCase keys for every service field.',
      'Re-run verification — all 5 mapping cases should flip to passing together.',
    ],
    notTested: ['Nested objects (availability windows, location) which may hide more snake_case fields', 'Request payloads sent back to the API'],
  },
  {
    key: 'db-pool-100',
    severity: 'high',
    category: 'database',
    title: 'Connection pool exhausted at 100 users — 18% error rate',
    description:
      'Under the ramp to 100 users, GET /api/bookings hit the pg pool ceiling (pool.max=10). Requests queued until the 5s timeout, producing an 18.2% error rate and p95 of 4.2s. The pool serves 50 users fine, so the breaking point is exactly at 100.',
    filePath: 'src/db/pool.ts',
    line: 9,
    endpoint: 'GET /api/bookings',
    confidence: 0.89,
    evidenceValidated: true,
    evidence: [poolEvidenceLog, poolEvidenceHttp],
    whyItMatters:
      'The pool config caps the whole API. Any traffic spike converts clean 200s into 500s — the failure mode in production is a cascading outage, not slow responses.',
    howToFix: [
      'Raise pool max to at least 4× vCPU and make it configurable per environment.',
      'Set connectionTimeoutMillis to ~2s so waiting requests fail fast instead of stacking.',
      'Add pool saturation metrics and an alert at >80% utilization.',
      'Re-run the load test at 50 and 100 users to confirm the error rate drops to ~0.',
    ],
    notTested: ['Behavior beyond 100 users', 'Pool holdings by long-running reports', 'Postgres max_connections headroom across replicas'],
  },
  {
    key: 'n1-bookings',
    severity: 'medium',
    category: 'performance',
    title: 'N+1 queries on GET /api/bookings (41 queries per request)',
    description:
      'Listing bookings issues 1 query for the page and then 1 query per booking to fetch its service (40 bookings → 41 queries). The endpoint budget is 10.',
    filePath: 'src/repositories/booking.repo.ts',
    line: 63,
    endpoint: 'GET /api/bookings',
    confidence: 0.74,
    evidenceValidated: true,
    evidence: [n1EvidenceLog],
    whyItMatters:
      'This multiplies database load exactly when the pool is already under pressure, and it makes the pool fix harder to land.',
    howToFix: [
      'Batch-load services by id set, or join services in the bookings query.',
      'Add a query-count assertion to the API test for /api/bookings.',
    ],
    notTested: ['Query counts under production data volumes', 'Whether list filters change the query shape'],
  },
  {
    key: 'dep-express-cve',
    severity: 'low',
    category: 'security',
    title: 'express <4.17.3 has a known prototype-pollution advisory (CVE-2022-24999)',
    description:
      'Static advisory matching flagged express 4.16.4 (used with qs <6.10.3). No runtime exploit was observed; the finding comes from the dependency audit only.',
    filePath: 'package.json',
    line: 24,
    confidence: 0.82,
    evidenceValidated: true,
    evidence: [depEvidenceLog],
    whyItMatters:
      'Prototype pollution in parsers can become request-splitting or auth-bypass primitives when combined with other bugs. It is cheap to remove.',
    howToFix: ['Upgrade express to >=4.21.0.', 'Add `npm audit --audit-level=high` to CI so advisories surface automatically.'],
    notTested: ['Runtime exploitability (no proof-of-concept was run)', 'Transitive usage patterns of the affected parser'],
  },
  {
    key: 'intermittent-500',
    severity: 'low',
    category: 'api',
    title: 'Intermittent 500 on POST /api/bookings during ramp-up (unreproduced)',
    description:
      'One 500 appeared at ~40 users with a "write conflict". Retrying with the identical payload succeeded, and the failure did not reproduce in 45,000 subsequent requests.',
    endpoint: 'POST /api/bookings',
    confidence: 0.41,
    evidenceValidated: false,
    evidence: [unexplainedEvidenceLog],
    whyItMatters:
      'We are surfacing this without a validated explanation rather than guessing. It may be noise from the load harness, or the first symptom of a real write-race. Treat it as unknown.',
    howToFix: [
      'Capture the full request trace the next time it occurs (request_id is logged).',
      'Add a retry-with-backoff probe specifically around booking creation at 40–60 users.',
    ],
    notTested: ['Everything — the failure did not reproduce', 'Correlation with deployment or migration timing', 'Whether the write conflict is a real race condition'],
  },
  {
    key: 'services-latency-regression',
    severity: 'low',
    category: 'performance',
    title: 'GET /api/services p95 up 50% vs 7-day baseline at 100 users',
    description:
      'After the mapping fix the endpoint is functionally correct, but the load test shows p95 latency at 100 users grew from 120ms (7-day baseline) to 180ms. Absolute numbers are healthy; the trend tripped the ±25% delta budget.',
    filePath: 'src/services/service.repository.ts',
    line: 42,
    endpoint: 'GET /api/services',
    confidence: 0.68,
    evidenceValidated: true,
    evidence: [latencyEvidenceLog],
    whyItMatters:
      'Small latency regressions compound release over release. Catching the trend now is far cheaper than untangling it at 3× the baseline later.',
    howToFix: [
      'Profile the services query with EXPLAIN ANALYZE and confirm the index on services(id) is used.',
      'Check whether the new mapper adds per-row object allocation in a hot loop.',
      'Keep the perf-budget check in CI so future regressions surface with evidence.',
    ],
    notTested: ['Root cause — this is a delta observation, not a diagnosis', 'Behavior beyond 100 users', 'Whether cold-start effects skew the baseline'],
  },
]

export function buildFindings(
  runId: string,
  projectId: string,
  keys: string[],
  createdAt: string,
): Finding[] {
  return FINDING_SEEDS.filter((seed) => keys.includes(seed.key)).map((seed, index) => ({
    id: `${runId}_f${index + 1}`,
    runId,
    projectId,
    fingerprint: `fp.${seed.key}`,
    severity: seed.severity,
    category: seed.category,
    title: seed.title,
    description: seed.description,
    filePath: seed.filePath,
    line: seed.line,
    endpoint: seed.endpoint,
    table: seed.table,
    clusterId: seed.clusterId,
    clusterSize: seed.clusterSize,
    confidence: seed.confidence,
    evidenceValidated: seed.evidenceValidated,
    evidence: seed.evidence,
    whyItMatters: seed.whyItMatters,
    howToFix: seed.howToFix,
    notTested: seed.notTested,
    createdAt,
  }))
}

/* -------------------------------- Load tests -------------------------------- */

function levels(rows: Array<[number, number, number, number, number, number]>): LoadLevelResult[] {
  return rows.map(([users, p50Ms, p95Ms, p99Ms, errorRatePct, requestsPerSecond]) => ({
    users,
    p50Ms,
    p95Ms,
    p99Ms,
    errorRatePct,
    requestsPerSecond,
  }))
}

const BOOKINGS_ROUTE: RouteLoadResult = {
  route: '/api/bookings',
  method: 'GET',
  levels: levels([
    [1, 42, 61, 88, 0, 38],
    [10, 55, 84, 120, 0, 322],
    [50, 96, 148, 210, 0.4, 1_180],
    [100, 2_410, 4_220, 6_110, 18.2, 2_140],
  ]),
  breakingPointUsers: 100,
  peakRps: 2_140,
}

const SERVICES_ROUTE: RouteLoadResult = {
  route: '/api/services',
  method: 'GET',
  levels: levels([
    [1, 28, 41, 60, 0, 44],
    [10, 33, 52, 74, 0, 388],
    [50, 48, 88, 132, 0, 1_420],
    [100, 62, 120, 180, 0.2, 2_440],
  ]),
  peakRps: 2_440,
}

const POST_BOOKINGS_ROUTE: RouteLoadResult = {
  route: '/api/bookings',
  method: 'POST',
  levels: levels([
    [1, 60, 84, 120, 0, 22],
    [10, 78, 142, 208, 0.1, 182],
    [50, 150, 320, 480, 0.6, 640],
    [100, 380, 5_200, 7_400, 2.1, 720],
  ]),
  breakingPointUsers: 100,
  peakRps: 720,
}

export function buildLoadTest(runId: string, generatedAt: string, healthy = false): LoadTestResult {
  const routes = healthy
    ? [
        { ...SERVICES_ROUTE },
        {
          ...BOOKINGS_ROUTE,
          levels: levels([
            [1, 41, 58, 80, 0, 39],
            [10, 52, 76, 104, 0, 330],
            [50, 79, 131, 190, 0.1, 1_260],
            [100, 122, 248, 380, 0.3, 2_380],
          ]),
          breakingPointUsers: undefined,
          peakRps: 2_380,
        },
      ]
    : [BOOKINGS_ROUTE, SERVICES_ROUTE, POST_BOOKINGS_ROUTE]
  return {
    runId,
    generatedAt,
    routes,
    thresholdErrorRatePct: 5,
    thresholdP95Ms: 800,
  }
}

/* ---------------------------------- Runs ----------------------------------- */

export function makeStages(): RunStageProgress[] {
  return RUN_STAGE_ORDER.map((stage) => ({ stage, status: 'queued' as CheckStatus }))
}

interface HistoricalRunSeed {
  id: string
  msAgo: number
  status: Run['status']
  healthScore: number
  durationMs: number
  failingKeys: readonly string[]
  findingKeys: string[]
}

const bookingHistory: HistoricalRunSeed[] = [
  { id: RUN_IDS.bookingLatest, msAgo: 34 * MIN, status: 'failed', healthScore: 62, durationMs: 402_000, failingKeys: STORY_FAILING_KEYS, findingKeys: ['admin-route-noauth', 'service-list-404', 'mapping-service-ids', 'db-pool-100', 'n1-bookings', 'dep-express-cve', 'intermittent-500'] },
  { id: RUN_IDS.bookingPrev, msAgo: 2 * DAY, status: 'failed', healthScore: 63, durationMs: 388_000, failingKeys: ['authz-matrix', 'mapping-validate', 'data-probe', 'load-bookings', 'audit-deps'], findingKeys: ['admin-route-noauth', 'mapping-service-ids', 'db-pool-100', 'dep-express-cve', 'intermittent-500'] },
  { id: RUN_IDS.bookingMid, msAgo: 4 * DAY, status: 'failed', healthScore: 76, durationMs: 351_000, failingKeys: ['audit-deps', 'mapping-validate'], findingKeys: ['mapping-service-ids', 'dep-express-cve'] },
  { id: RUN_IDS.bookingOld, msAgo: 6 * DAY, status: 'passed', healthScore: 90, durationMs: 342_000, failingKeys: [], findingKeys: [] },
  { id: RUN_IDS.bookingPass1, msAgo: 9 * DAY, status: 'passed', healthScore: 89, durationMs: 338_000, failingKeys: [], findingKeys: [] },
  { id: RUN_IDS.bookingPass2, msAgo: 12 * DAY, status: 'passed', healthScore: 91, durationMs: 331_000, failingKeys: [], findingKeys: [] },
]

export interface SeededWorld {
  projects: Project[]
  runs: Run[]
  checks: Check[]
  findings: Finding[]
  loadTests: Map<string, LoadTestResult>
  commits: Commit[]
  structure: Map<string, StructureMap>
}

export function buildSeedWorld(): SeededWorld {
  const projects: Project[] = [
    {
      id: 'p_booking',
      name: 'booking-app',
      source: 'git',
      gitUrl: 'https://github.com/acme/booking-app',
      branch: 'main',
      stack: bookingStack,
      routeCount: 12,
      tableCount: 6,
      componentCount: 12,
      apiCallCount: 9,
      settings: { ...defaultSettings },
      latestRun: null,
      createdAt: iso(180 * DAY),
      updatedAt: iso(34 * MIN),
    },
    {
      id: 'p_payments',
      name: 'payments-service',
      source: 'git',
      gitUrl: 'https://github.com/acme/payments-service',
      branch: 'release/2.x',
      stack: paymentsStack,
      routeCount: 8,
      tableCount: 4,
      componentCount: 0,
      apiCallCount: 0,
      settings: { ...defaultSettings, defaultLoadUsers: 100 },
      latestRun: null,
      createdAt: iso(320 * DAY),
      updatedAt: iso(1 * DAY),
    },
    {
      id: 'p_webdash',
      name: 'web-dashboard',
      source: 'git',
      gitUrl: 'https://github.com/acme/web-dashboard',
      branch: 'main',
      stack: webDashStack,
      routeCount: 21,
      tableCount: 0,
      componentCount: 64,
      apiCallCount: 14,
      settings: { ...defaultSettings, defaultLoadUsers: 25 },
      latestRun: null,
      createdAt: iso(90 * DAY),
      updatedAt: iso(3 * HOUR),
    },
    {
      id: 'p_mobile',
      name: 'mobile-api',
      source: 'zip',
      stack: mobileApiStack,
      routeCount: 6,
      tableCount: 3,
      componentCount: 0,
      apiCallCount: 0,
      settings: { ...defaultSettings },
      latestRun: null,
      createdAt: iso(6 * DAY),
      updatedAt: iso(6 * DAY),
    },
  ]

  const runs: Run[] = []
  const checks: Check[] = []
  const findings: Finding[] = []
  const loadTests = new Map<string, LoadTestResult>()

  for (const seed of bookingHistory) {
    const startedAtMs = now - seed.msAgo
    const startedAt = iso(seed.msAgo)
    const finishedAt = iso(seed.msAgo - seed.durationMs)
    const stages = makeStages().map((stage) => ({
      ...stage,
      status: 'passed' as CheckStatus,
      startedAt,
      finishedAt,
    }))
    if (seed.failingKeys.length > 0) {
      // mark the stages that own failing checks as failed
      for (const stage of stages) {
        if (['api_tests', 'data_fetch', 'mapping', 'database', 'load', 'security'].includes(stage.stage)) {
          stage.status = 'failed'
        }
      }
    }
    runs.push({
      id: seed.id,
      projectId: 'p_booking',
      projectName: 'booking-app',
      status: seed.status,
      trigger: 'manual',
      stages,
      healthScore: seed.healthScore,
      passedChecks: 21 - seed.failingKeys.length,
      failedChecks: seed.failingKeys.length,
      totalChecks: 21,
      startedAt,
      finishedAt,
      durationMs: seed.durationMs,
      loadUsers: 100,
      commitSha: commitsForBooking[0]?.sha,
    })
    checks.push(...buildChecks(seed.id, seed.failingKeys, startedAtMs))
    findings.push(...buildFindings(seed.id, 'p_booking', seed.findingKeys, finishedAt))
    loadTests.set(seed.id, buildLoadTest(seed.id, finishedAt, seed.failingKeys.length === 0))
  }

  // payments-service — one pass, one fail
  const pStarted = iso(1 * DAY)
  const pRun: Run = {
    id: RUN_IDS.paymentsLatest,
    projectId: 'p_payments',
    projectName: 'payments-service',
    status: 'passed',
    trigger: 'ci',
    stages: makeStages().map((stage) => ({ ...stage, status: 'passed', startedAt: pStarted, finishedAt: iso(1 * DAY - 240_000) })),
    healthScore: 94,
    passedChecks: 8,
    failedChecks: 0,
    totalChecks: 8,
    startedAt: pStarted,
    finishedAt: iso(1 * DAY - 240_000),
    durationMs: 240_000,
    loadUsers: 100,
  }
  runs.push(pRun)
  checks.push(...buildCleanChecks(pRun.id, now - 1 * DAY))
  loadTests.set(pRun.id, buildLoadTest(pRun.id, pRun.finishedAt ?? pStarted, true))

  const pOld: Run = {
    id: RUN_IDS.paymentsPrev,
    projectId: 'p_payments',
    projectName: 'payments-service',
    status: 'failed',
    trigger: 'manual',
    stages: makeStages().map((stage) => ({ ...stage, status: 'passed', startedAt: iso(5 * DAY), finishedAt: iso(5 * DAY - 220_000) })),
    healthScore: 77,
    passedChecks: 6,
    failedChecks: 2,
    totalChecks: 8,
    startedAt: iso(5 * DAY),
    finishedAt: iso(5 * DAY - 220_000),
    durationMs: 220_000,
    loadUsers: 100,
  }
  runs.push(pOld)
  checks.push(...buildCleanChecks(pOld.id, now - 5 * DAY).slice(0, 8).map((check, index) => (index < 2 ? { ...check, status: 'failed' as CheckStatus, exitCode: 1 } : check)))
  loadTests.set(pOld.id, buildLoadTest(pOld.id, pOld.finishedAt ?? pOld.startedAt, false))

  // web-dashboard — one pass
  const wRun: Run = {
    id: RUN_IDS.webDashLatest,
    projectId: 'p_webdash',
    projectName: 'web-dashboard',
    status: 'passed',
    trigger: 'ci',
    stages: makeStages().map((stage) => ({ ...stage, status: 'passed', startedAt: iso(3 * HOUR), finishedAt: iso(3 * HOUR - 190_000) })),
    healthScore: 88,
    passedChecks: 8,
    failedChecks: 0,
    totalChecks: 8,
    startedAt: iso(3 * HOUR),
    finishedAt: iso(3 * HOUR - 190_000),
    durationMs: 190_000,
    loadUsers: 25,
  }
  runs.push(wRun)
  checks.push(...buildCleanChecks(wRun.id, now - 3 * HOUR))
  loadTests.set(wRun.id, buildLoadTest(wRun.id, wRun.finishedAt ?? wRun.startedAt, true))

  // attach latestRun summaries
  for (const project of projects) {
    const projectRuns = runs
      .filter((run) => run.projectId === project.id)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    const latest = projectRuns[0]
    project.latestRun = latest
      ? { id: latest.id, status: latest.status, healthScore: latest.healthScore, startedAt: latest.startedAt }
      : null
  }

  return {
    projects,
    runs,
    checks,
    findings,
    loadTests,
    commits: commitsForBooking,
    structure: new Map<string, StructureMap>([
      ['p_booking', bookingStructure],
      ['p_payments', paymentsStructure],
      ['p_webdash', webDashStructure],
      ['p_mobile', mobileStructure],
    ]),
  }
}

/* ------------------------------- Structure maps ----------------------------- */

const bookingStructure: StructureMap = {
  routes: [
    { method: 'POST', path: '/api/auth/login', file: 'src/routes/auth.routes.ts', auth: 'public' },
    { method: 'POST', path: '/api/auth/register', file: 'src/routes/auth.routes.ts', auth: 'public' },
    { method: 'GET', path: '/api/services', file: 'src/routes/services.routes.ts', auth: 'public' },
    { method: 'GET', path: '/api/services/:id', file: 'src/routes/services.routes.ts', auth: 'public' },
    { method: 'GET', path: '/api/bookings', file: 'src/routes/bookings.routes.ts', auth: 'user' },
    { method: 'POST', path: '/api/bookings', file: 'src/routes/bookings.routes.ts', auth: 'user' },
    { method: 'PATCH', path: '/api/bookings/:id', file: 'src/routes/bookings.routes.ts', auth: 'user' },
    { method: 'DELETE', path: '/api/bookings/:id', file: 'src/routes/bookings.routes.ts', auth: 'user' },
    { method: 'GET', path: '/api/users/me', file: 'src/routes/users.routes.ts', auth: 'user' },
    { method: 'GET', path: '/api/health', file: 'src/routes/health.routes.ts', auth: 'public' },
    { method: 'GET', path: '/api/admin/users', file: 'src/routes/admin.routes.ts', auth: 'none-detected', issue: 'No auth middleware — verified reachable without a token' },
    { method: 'POST', path: '/api/admin/seed', file: 'src/routes/admin.routes.ts', auth: 'none-detected', issue: 'Same missing middleware as /api/admin/users' },
  ],
  tables: [
    { name: 'users', columns: [{ name: 'id', type: 'uuid' }, { name: 'email', type: 'text' }, { name: 'name', type: 'text' }, { name: 'role', type: 'text' }, { name: 'created_at', type: 'timestamptz' }], relations: ['bookings.user_id → users.id'] },
    { name: 'services', columns: [{ name: 'id', type: 'int' }, { name: 'service_id', type: 'text' }, { name: 'name', type: 'text' }, { name: 'price_cents', type: 'int' }, { name: 'duration_min', type: 'int' }], relations: ['availability.service_id → services.id', 'bookings.service_id → services.id'] },
    { name: 'availability', columns: [{ name: 'id', type: 'int' }, { name: 'service_id', type: 'int' }, { name: 'day_of_week', type: 'int' }, { name: 'start_time', type: 'time' }, { name: 'end_time', type: 'time' }], relations: ['services.id'] },
    { name: 'bookings', columns: [{ name: 'id', type: 'uuid' }, { name: 'user_id', type: 'uuid' }, { name: 'service_id', type: 'int' }, { name: 'starts_at', type: 'timestamptz' }, { name: 'status', type: 'text' }, { name: 'created_at', type: 'timestamptz' }], relations: ['users.id', 'services.id'] },
    { name: 'payments', columns: [{ name: 'id', type: 'uuid' }, { name: 'booking_id', type: 'uuid' }, { name: 'amount_cents', type: 'int' }, { name: 'status', type: 'text' }], relations: ['bookings.id'] },
    { name: 'audit_log', columns: [{ name: 'id', type: 'bigint' }, { name: 'actor_id', type: 'uuid', nullable: true }, { name: 'action', type: 'text' }, { name: 'target', type: 'text' }, { name: 'created_at', type: 'timestamptz' }], relations: [] },
  ],
  components: [
    { name: 'BookingPage', path: 'src/pages/BookingPage.tsx', kind: 'page' },
    { name: 'ServiceListPage', path: 'src/pages/ServiceListPage.tsx', kind: 'page' },
    { name: 'AdminPage', path: 'src/pages/AdminPage.tsx', kind: 'page' },
    { name: 'ProfilePage', path: 'src/pages/ProfilePage.tsx', kind: 'page' },
    { name: 'BookingForm', path: 'src/components/BookingForm.tsx', kind: 'component' },
    { name: 'ServiceCard', path: 'src/components/ServiceCard.tsx', kind: 'component' },
    { name: 'NavBar', path: 'src/components/NavBar.tsx', kind: 'component' },
    { name: 'RequireAuth', path: 'src/components/RequireAuth.tsx', kind: 'component' },
    { name: 'useBookings', path: 'src/hooks/useBookings.ts', kind: 'hook' },
    { name: 'useServices', path: 'src/hooks/useServices.ts', kind: 'hook' },
    { name: 'apiClient', path: 'src/services/apiClient.ts', kind: 'service' },
    { name: 'AuthContext', path: 'src/context/AuthContext.tsx', kind: 'context' },
  ],
  apiCalls: [
    { from: 'ServiceListPage', method: 'GET', path: '/api/service-list', status: 'broken', note: 'Returns 404 — backend exposes /api/services' },
    { from: 'AdminPage', method: 'GET', path: '/api/admin/users', status: 'broken', note: 'No auth middleware on the route' },
    { from: 'AdminPage', method: 'POST', path: '/api/admin/seed', status: 'broken', note: 'Same missing middleware' },
    { from: 'BookingForm', method: 'POST', path: '/api/bookings', status: 'ok' },
    { from: 'BookingPage', method: 'GET', path: '/api/bookings', status: 'ok' },
    { from: 'ServiceCard', method: 'GET', path: '/api/services/:id', status: 'ok' },
    { from: 'AuthContext', method: 'POST', path: '/api/auth/login', status: 'ok' },
    { from: 'NavBar', method: 'GET', path: '/api/users/me', status: 'ok' },
    { from: 'RequireAuth', method: 'POST', path: '/api/auth/refresh', status: 'ok' },
  ],
}

const paymentsStructure: StructureMap = {
  routes: [
    { method: 'POST', path: '/api/charges', file: 'internal/http/charges.go', auth: 'user' },
    { method: 'GET', path: '/api/charges/:id', file: 'internal/http/charges.go', auth: 'user' },
    { method: 'POST', path: '/api/refunds', file: 'internal/http/refunds.go', auth: 'admin' },
    { method: 'GET', path: '/api/webhooks/stripe', file: 'internal/http/webhooks.go', auth: 'public' },
    { method: 'GET', path: '/healthz', file: 'internal/http/health.go', auth: 'public' },
  ],
  tables: [
    { name: 'charges', columns: [{ name: 'id', type: 'uuid' }, { name: 'amount_cents', type: 'int' }, { name: 'status', type: 'text' }], relations: [] },
    { name: 'refunds', columns: [{ name: 'id', type: 'uuid' }, { name: 'charge_id', type: 'uuid' }, { name: 'amount_cents', type: 'int' }], relations: ['charges.id'] },
  ],
  components: [],
  apiCalls: [],
}

const webDashStructure: StructureMap = {
  routes: [
    { method: 'GET', path: '/api/metrics/overview', file: 'app/api/metrics/route.ts', auth: 'user' },
    { method: 'GET', path: '/api/metrics/revenue', file: 'app/api/metrics/route.ts', auth: 'user' },
  ],
  tables: [],
  components: [
    { name: 'OverviewPage', path: 'app/(dashboard)/overview/page.tsx', kind: 'page' },
    { name: 'RevenueChart', path: 'components/charts/RevenueChart.tsx', kind: 'component' },
  ],
  apiCalls: [{ from: 'OverviewPage', method: 'GET', path: '/api/metrics/overview', status: 'ok' }],
}

const mobileStructure: StructureMap = {
  routes: [
    { method: 'POST', path: '/api/v1/devices', file: 'src/routes/devices.ts', auth: 'user' },
    { method: 'POST', path: '/api/v1/push', file: 'src/routes/push.ts', auth: 'user' },
  ],
  tables: [{ name: 'devices', columns: [{ name: 'id', type: 'uuid' }, { name: 'push_token', type: 'text' }], relations: [] }],
  components: [],
  apiCalls: [],
}

export function simpleStructure(): StructureMap {
  return {
    routes: [
      { method: 'GET', path: '/api/health', file: 'src/routes/health.ts', auth: 'public' },
      { method: 'GET', path: '/api/items', file: 'src/routes/items.ts', auth: 'user' },
      { method: 'POST', path: '/api/items', file: 'src/routes/items.ts', auth: 'user' },
    ],
    tables: [{ name: 'items', columns: [{ name: 'id', type: 'uuid' }, { name: 'name', type: 'text' }], relations: [] }],
    components: [{ name: 'ItemListPage', path: 'src/pages/ItemListPage.tsx', kind: 'page' }],
    apiCalls: [{ from: 'ItemListPage', method: 'GET', path: '/api/items', status: 'ok' }],
  }
}

/* --------------------------------- Commits ---------------------------------- */

export const commitsForBooking: Commit[] = [
  {
    sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    shortSha: 'a1b2c3d',
    projectId: 'p_booking',
    message: 'feat: add service list page',
    llmDescription:
      'Adds a new /services page with a client call to GET /api/service-list and a card grid. The backend exposes /api/services instead, so the page fetch 404s. The new route in the SPA also increases the surface area covered by the E2E suite.',
    author: 'Maya Chen',
    committedAt: iso(1 * DAY),
    filesChanged: [
      { path: 'src/pages/ServiceListPage.tsx', change: 'added', additions: 184, deletions: 0 },
      { path: 'src/api/services.ts', change: 'added', additions: 46, deletions: 0 },
      { path: 'src/types/service.types.ts', change: 'added', additions: 18, deletions: 0 },
      { path: 'src/App.tsx', change: 'modified', additions: 6, deletions: 1 },
      { path: 'tests/e2e/service-list.spec.ts', change: 'added', additions: 41, deletions: 0 },
    ],
    additions: 295,
    deletions: 1,
    testsAffected: ['tests/e2e/service-list.spec.ts', 'tests/bookings.spec.ts'],
    failingTests: ['E2E: service list page renders'],
    risk: {
      score: 74,
      level: 'high',
      signals: [
        { label: 'New API call added', description: 'Frontend now depends on an endpoint that no backend test covers.', weight: 0.9 },
        { label: 'Contract not verified', description: 'GET /api/service-list is not part of the backend route table.', weight: 0.85 },
        { label: 'E2E coverage added', description: 'The new page is covered by a Playwright test, which is how the 404 was proven.', weight: 0.3 },
      ],
    },
    suggestedAction:
      'Change the client call to GET /api/services (one-line fix in src/api/services.ts), then rerun verification — the service-list E2E is the proof it works.',
  },
  {
    sha: '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432',
    shortSha: '9f8e7d6',
    projectId: 'p_booking',
    message: 'feat: admin dashboard (WIP)',
    llmDescription:
      'Introduces the /admin area with user listing and a demo-data seed action. The router is mounted without auth middleware, leaving every admin endpoint publicly reachable. This is the root cause of the Critical security finding.',
    author: 'Ravi Patel',
    committedAt: iso(2 * DAY),
    filesChanged: [
      { path: 'src/routes/admin.routes.ts', change: 'added', additions: 24, deletions: 0 },
      { path: 'src/controllers/admin.controller.ts', change: 'added', additions: 96, deletions: 0 },
      { path: 'src/pages/AdminPage.tsx', change: 'added', additions: 158, deletions: 0 },
      { path: 'src/server.ts', change: 'modified', additions: 2, deletions: 0 },
    ],
    additions: 280,
    deletions: 0,
    testsAffected: [],
    failingTests: ['Route authorization matrix (unauthenticated probes)'],
    risk: {
      score: 86,
      level: 'high',
      signals: [
        { label: 'New privileged route', description: 'Adds /api/admin/* endpoints that list all users and mutate demo data.', weight: 1 },
        { label: 'No auth middleware', description: 'Router mounted without requireAuth/requireRole.', weight: 1 },
        { label: 'Zero test coverage', description: 'No tests were added for the new routes.', weight: 0.8 },
      ],
    },
    suggestedAction:
      'Apply requireAuth + requireRole("admin") to the admin router before this ships, and add a supertest that asserts 401 without a token.',
  },
  {
    sha: '7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a291807f6e5',
    shortSha: '7c6b5a4',
    projectId: 'p_booking',
    message: 'fix: normalize snake_case payloads in booking service',
    llmDescription:
      'Partially normalizes API payloads for bookings but leaves the service mapper untouched — service_id still leaks through as-is. 5 mapping cases fail with this single root cause.',
    author: 'Varun Sharma',
    committedAt: iso(3 * DAY),
    filesChanged: [
      { path: 'src/mappers/booking.mapper.ts', change: 'modified', additions: 12, deletions: 4 },
      { path: 'src/mappers/service.mapper.ts', change: 'modified', additions: 2, deletions: 2 },
    ],
    additions: 14,
    deletions: 6,
    testsAffected: ['tests/mappers.spec.ts'],
    failingTests: ['Field mapping: frontend ↔ API (5 cases)'],
    risk: {
      score: 68,
      level: 'medium',
      signals: [
        { label: 'API contract touched', description: 'Mappers are the boundary between DB rows and frontend models.', weight: 0.7 },
        { label: 'Partial fix detected', description: 'Sibling mapper (service.mapper.ts) has the same defect left unfixed.', weight: 0.6 },
      ],
    },
    suggestedAction: 'Finish the normalization in src/mappers/service.mapper.ts:18 (see the suggested diff on the mapping finding).',
  },
  {
    sha: '3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e',
    shortSha: '3d2e1f0',
    projectId: 'p_booking',
    message: 'refactor: extract mappers from controllers',
    llmDescription:
      'Moves row-to-model conversion out of controllers into dedicated mapper modules. No behavior change detected by the test suite. Slightly increases the blast radius of future contract changes by centralizing the translation layer.',
    author: 'Maya Chen',
    committedAt: iso(4 * DAY),
    filesChanged: [
      { path: 'src/mappers/booking.mapper.ts', change: 'added', additions: 84, deletions: 0 },
      { path: 'src/controllers/bookings.controller.ts', change: 'modified', additions: 8, deletions: 61 },
      { path: 'src/controllers/services.controller.ts', change: 'modified', additions: 6, deletions: 42 },
    ],
    additions: 98,
    deletions: 103,
    testsAffected: ['tests/bookings.spec.ts', 'tests/services.spec.ts'],
    failingTests: [],
    risk: {
      score: 46,
      level: 'medium',
      signals: [
        { label: 'Refactor across 3 files', description: 'Logic moved rather than changed — tests still pass.', weight: 0.4 },
        { label: 'Touches request path', description: 'Every booking and services response passes through the new mappers.', weight: 0.5 },
      ],
    },
    suggestedAction: 'No action required. Consider adding a snapshot test per mapper to lock the wire format.',
  },
  {
    sha: '5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b',
    shortSha: '5a4b3c2',
    projectId: 'p_booking',
    message: 'chore: bump dependencies + lockfile refresh',
    llmDescription:
      'Refreshes the lockfile and bumps minor versions. express itself remains pinned at 4.16.4, which carries the CVE-2022-24999 advisory flagged by the security baseline.',
    author: 'Ravi Patel',
    committedAt: iso(5 * DAY),
    filesChanged: [
      { path: 'package.json', change: 'modified', additions: 14, deletions: 11 },
      { path: 'package-lock.json', change: 'modified', additions: 4_102, deletions: 2_930 },
    ],
    additions: 4_116,
    deletions: 2_941,
    testsAffected: [],
    failingTests: ['Dependency audit (npm audit --audit-level=high)'],
    risk: {
      score: 24,
      level: 'low',
      signals: [
        { label: 'Lockfile churn', description: 'Large diff, but mechanical.', weight: 0.2 },
        { label: 'Advisory left open', description: 'express was not bumped past the fixed version.', weight: 0.5 },
      ],
    },
    suggestedAction: 'Bump express to >=4.21.0 and add npm audit to CI (see the dependency finding).',
  },
  {
    sha: '8e7d6c5b4a39281706f5e4d3c2b1a0987654321e',
    shortSha: '8e7d6c5',
    projectId: 'p_booking',
    message: 'feat: bookings list with filter + pagination',
    llmDescription:
      'Adds server-side filtering and pagination to GET /api/bookings. The list query fetches bookings, then loads each service separately — the source of the 41-queries-per-request pattern flagged by the query audit.',
    author: 'Maya Chen',
    committedAt: iso(7 * DAY),
    filesChanged: [
      { path: 'src/repositories/booking.repo.ts', change: 'modified', additions: 96, deletions: 22 },
      { path: 'src/controllers/bookings.controller.ts', change: 'modified', additions: 34, deletions: 8 },
      { path: 'tests/api/bookings.spec.ts', change: 'modified', additions: 58, deletions: 2 },
    ],
    additions: 188,
    deletions: 32,
    testsAffected: ['tests/api/bookings.spec.ts'],
    failingTests: [],
    risk: {
      score: 52,
      level: 'medium',
      signals: [
        { label: 'Query pattern changed', description: 'Row-by-row service fetch introduced (N+1).', weight: 0.6 },
        { label: 'Tests updated alongside', description: 'API tests cover the new filters.', weight: 0.3 },
      ],
    },
    suggestedAction: 'Batch-load services by id set in the list query (see the N+1 finding).',
  },
]

export const commitsForOthers: Commit[] = [
  {
    sha: 'c0ffee1234567890abcdef1234567890abcdef12',
    shortSha: 'c0ffee1',
    projectId: 'p_payments',
    message: 'fix: idempotency key on charge creation',
    llmDescription: 'Adds an idempotency key header check before inserting a charge. Covered by two new go test cases.',
    author: 'Ravi Patel',
    committedAt: iso(1 * DAY),
    filesChanged: [{ path: 'internal/http/charges.go', change: 'modified', additions: 42, deletions: 6 }],
    additions: 42,
    deletions: 6,
    testsAffected: ['internal/http/charges_test.go'],
    failingTests: [],
    risk: { score: 31, level: 'low', signals: [{ label: 'Payment path', description: 'Touches the charge-creation endpoint.', weight: 0.4 }] },
    suggestedAction: 'No action required.',
  },
  {
    sha: 'beefbeefbeefbeefbeefbeefbeefbeefbeefbeef',
    shortSha: 'beefbee',
    projectId: 'p_payments',
    message: 'feat: refund endpoint (admin only)',
    llmDescription: 'Adds POST /api/refunds restricted to admin tokens. Auth middleware is applied at the router level.',
    author: 'Maya Chen',
    committedAt: iso(5 * DAY),
    filesChanged: [{ path: 'internal/http/refunds.go', change: 'added', additions: 87, deletions: 0 }],
    additions: 87,
    deletions: 0,
    testsAffected: [],
    failingTests: [],
    risk: { score: 58, level: 'medium', signals: [{ label: 'Privileged endpoint', description: 'Admin-only route, tested manually only.', weight: 0.6 }] },
    suggestedAction: 'Add an integration test asserting 403 for non-admin tokens.',
  },
  {
    sha: 'd00d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d',
    shortSha: 'd00d1e2',
    projectId: 'p_webdash',
    message: 'feat: revenue chart on overview',
    llmDescription: 'Adds a Recharts area chart fed by /api/metrics/revenue. Server route aggregates per-day revenue.',
    author: 'Varun Sharma',
    committedAt: iso(3 * HOUR),
    filesChanged: [
      { path: 'components/charts/RevenueChart.tsx', change: 'added', additions: 122, deletions: 0 },
      { path: 'app/api/metrics/route.ts', change: 'modified', additions: 38, deletions: 4 },
    ],
    additions: 160,
    deletions: 4,
    testsAffected: ['tests/revenue-chart.spec.tsx'],
    failingTests: [],
    risk: { score: 28, level: 'low', signals: [{ label: 'Read-only path', description: 'No writes, no auth surface changes.', weight: 0.2 }] },
    suggestedAction: 'No action required.',
  },
]
