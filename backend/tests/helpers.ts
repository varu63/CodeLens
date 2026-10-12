import type { ArtifactRow } from '../src/db/queries/artifacts.queries.js'
import type { CheckRow } from '../src/db/queries/checks.queries.js'
import type { FindingRow } from '../src/db/queries/findings.queries.js'

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export function makeFinding(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: uuid(1),
    runId: uuid(2),
    projectId: uuid(3),
    clusterId: null,
    severity: 'high',
    category: 'api',
    title: 'Endpoint /api/items answers 500',
    description: 'The probe captured a server error.',
    whyItMatters: 'Users cannot load the items list.',
    filePath: 'src/api.mjs',
    lineNumber: 12,
    endpoint: 'GET /api/items',
    dbTable: null,
    fingerprint: 'fp.items.500',
    evidenceIds: [{ type: 'artifact', id: uuid(9) }],
    fixSteps: ['Fix the handler', 'Re-run verification'],
    confidence: 0.9,
    notTested: [],
    explained: true,
    evidenceCache: [{ kind: 'log', title: 'Probe output', content: 'HTTP 500', language: 'text' }],
    createdAt: new Date('2026-10-01T10:00:00Z'),
    ...overrides,
  }
}

export function makeCheck(overrides: Partial<CheckRow> = {}): CheckRow {
  return {
    id: uuid(4),
    runId: uuid(2),
    type: 'api',
    name: 'API contract tests',
    command: 'npm test',
    exitCode: 0,
    durationMs: 1200,
    status: 'passed',
    message: null,
    sortOrder: 1,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    ...overrides,
  }
}

export function makeArtifact(overrides: Partial<ArtifactRow> = {}): ArtifactRow {
  return {
    id: uuid(9),
    runId: uuid(2),
    checkId: uuid(4),
    name: 'test-output.log',
    kind: 'log',
    storageUrl: 'runs/x/test-output.log',
    sha256: null,
    sizeBytes: 2048,
    createdAt: new Date('2026-10-01T10:00:00Z'),
    ...overrides,
  }
}
