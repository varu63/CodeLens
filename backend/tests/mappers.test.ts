import { describe, expect, it } from 'vitest'
import {
  toApiArtifact,
  toApiCheck,
  toApiFinding,
  toApiRunStatus,
  toApiSettings,
  toApiStack,
} from '../src/utils/mappers.js'
import { makeArtifact, makeCheck, makeFinding } from './helpers.js'

describe('toApiRunStatus', () => {
  it('folds error into failed, passes other statuses through', () => {
    expect(toApiRunStatus('error')).toBe('failed')
    expect(toApiRunStatus('queued')).toBe('queued')
    expect(toApiRunStatus('running')).toBe('running')
    expect(toApiRunStatus('passed')).toBe('passed')
    expect(toApiRunStatus('cancelled')).toBe('cancelled')
  })
})

describe('toApiSettings', () => {
  it('applies defaults for an empty settings object', () => {
    expect(toApiSettings({})).toEqual({
      defaultLoadUsers: 100,
      errorRateThresholdPct: 1,
      p95ThresholdMs: 1000,
    })
  })

  it('maps stored settings through', () => {
    expect(toApiSettings({ loadUsers: 250, thresholds: { errorRatePct: 2, p95Ms: 800 } })).toEqual({
      defaultLoadUsers: 250,
      errorRateThresholdPct: 2,
      p95ThresholdMs: 800,
    })
  })
})

describe('toApiStack', () => {
  it('returns the default stack for empty input', () => {
    const stack = toApiStack({})
    expect(stack.language).toBe('Unknown')
    expect(stack.packageManager).toBe('npm')
    expect(stack.testFrameworks).toEqual([])
  })

  it('merges detected values with per-field fallbacks', () => {
    const stack = toApiStack({
      language: 'TypeScript',
      frontend: 'React',
      testFrameworks: ['vitest', 42, null],
      dependencies: ['express'],
    })
    expect(stack.language).toBe('TypeScript')
    expect(stack.framework).toBe('Unknown')
    expect(stack.frontend).toBe('React')
    expect(stack.testFrameworks).toEqual(['vitest'])
    expect(stack.dependencies).toEqual(['express'])
  })
})

describe('toApiCheck', () => {
  it('maps error status to failed and omits a null message', () => {
    const check = toApiCheck(makeCheck({ status: 'error', message: null }))
    expect(check.status).toBe('failed')
    expect(check.message).toBeUndefined()
    expect(check.command).toBe('npm test')
  })

  it('collects artifact ids', () => {
    const artifacts = [makeArtifact(), makeArtifact({ id: '00000000-0000-4000-8000-000000000010' })]
    const check = toApiCheck(makeCheck({ message: 'ok' }), artifacts)
    expect(check.artifactIds).toHaveLength(2)
    expect(check.message).toBe('ok')
  })
})

describe('toApiArtifact', () => {
  it('defaults missing size to zero', () => {
    expect(toApiArtifact(makeArtifact({ sizeBytes: null })).sizeBytes).toBe(0)
  })
})

describe('toApiFinding', () => {
  it('maps a clustered finding with size and evidence', () => {
    const finding = toApiFinding(makeFinding({ clusterId: '00000000-0000-4000-8000-0000000000aa' }), 3)
    expect(finding.clusterId).toBe('00000000-0000-4000-8000-0000000000aa')
    expect(finding.clusterSize).toBe(3)
    expect(finding.evidenceValidated).toBe(true)
    expect(finding.evidence).toHaveLength(1)
    expect(finding.line).toBe(12)
    expect(finding.endpoint).toBe('GET /api/items')
    expect(finding.table).toBeUndefined()
  })

  it('omits cluster fields for an unclustered finding and defaults confidence', () => {
    const finding = toApiFinding(makeFinding({ clusterId: null, lineNumber: null, confidence: null }))
    expect(finding.clusterId).toBeUndefined()
    expect(finding.clusterSize).toBeUndefined()
    expect(finding.line).toBeUndefined()
    expect(finding.confidence).toBe(1)
  })

  it('falls back to the configuration category for unknown values', () => {
    const finding = toApiFinding(makeFinding({ category: 'mystery' }))
    expect(finding.category).toBe('configuration')
  })

  it('maps db_table to the table field', () => {
    const finding = toApiFinding(makeFinding({ dbTable: 'posts', filePath: null }))
    expect(finding.table).toBe('posts')
    expect(finding.filePath).toBeUndefined()
  })
})
