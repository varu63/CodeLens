import { describe, expect, it } from 'vitest'
import { knownFilePaths, uuidFromSeed, validateExplanation } from '../src/services/analysis.service.js'
import type { FindingExplanation } from '../src/services/ml.client.js'
import { makeFinding } from './helpers.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('uuidFromSeed', () => {
  it('is deterministic and uuid-shaped', () => {
    const first = uuidFromSeed('project|cluster|security|src/aws.mjs')
    expect(first).toBe(uuidFromSeed('project|cluster|security|src/aws.mjs'))
    expect(first).toMatch(UUID_RE)
    expect(uuidFromSeed('other seed')).not.toBe(first)
  })
})

describe('knownFilePaths', () => {
  it('walks nested structures collecting file-like string props', () => {
    const paths = knownFilePaths({
      components: [{ file: './src/App.tsx' }, { file: 'src/main.tsx' }],
      routes: [{ file: 'server.mjs', handler: 'getItems' }],
      apiCalls: [{ from: 'src/api.mjs', endpoint: '/api/items' }],
      deep: { nested: [{ filePath: 'src/deep.ts' }] },
      junk: [{ file: 42 }, { from: null }, 'string'],
    })
    expect(paths.has('src/App.tsx')).toBe(true)
    expect(paths.has('src/main.tsx')).toBe(true)
    expect(paths.has('server.mjs')).toBe(true)
    expect(paths.has('src/api.mjs')).toBe(true)
    expect(paths.has('src/deep.ts')).toBe(true)
    expect(paths.size).toBe(5)
  })

  it('handles empty and primitive input', () => {
    expect(knownFilePaths(undefined).size).toBe(0)
    expect(knownFilePaths('text').size).toBe(0)
    expect(knownFilePaths([]).size).toBe(0)
  })
})

describe('validateExplanation', () => {
  const finding = makeFinding({
    evidenceIds: [{ type: 'artifact', id: '00000000-0000-4000-8000-000000000009' }],
    filePath: 'src/api.mjs',
  })

  const explanation = (overrides: Partial<FindingExplanation>): FindingExplanation => ({
    whyItMatters: 'reason',
    fixSteps: [],
    citedEvidenceIds: [],
    citedFilePaths: [],
    ...overrides,
  })

  it('accepts citations of the finding own evidence and known files', () => {
    const ok = explanation({
      citedEvidenceIds: ['00000000-0000-4000-8000-000000000009'],
      citedFilePaths: ['src/api.mjs', 'src/other.ts'],
    })
    expect(validateExplanation(ok, finding, new Set(['src/other.ts']))).toBe(true)
  })

  it('accepts ./ prefixed citations via normalization', () => {
    expect(validateExplanation(explanation({ citedFilePaths: ['./src/api.mjs'] }), finding, new Set())).toBe(true)
  })

  it('rejects an explanation that cites evidence the finding does not own', () => {
    const bad = explanation({ citedEvidenceIds: ['00000000-0000-4000-8000-0000000000ff'] })
    expect(validateExplanation(bad, finding, new Set())).toBe(false)
  })

  it('rejects an explanation that cites a file nobody saw', () => {
    const bad = explanation({ citedFilePaths: ['src/imagined.ts'] })
    expect(validateExplanation(bad, finding, new Set(['src/api.mjs']))).toBe(false)
  })

  it('treats the finding own path as authoritative even outside the structure map', () => {
    const ok = explanation({ citedFilePaths: ['src/api.mjs'] })
    expect(validateExplanation(ok, finding, new Set())).toBe(true)
  })

  it('accepts an explanation with no citations at all', () => {
    expect(validateExplanation(explanation({}), finding, new Set())).toBe(true)
  })
})
