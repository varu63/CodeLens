import { describe, expect, it } from 'vitest'
import {
  clusterFindings,
  commitRisk,
  commitRiskLevel,
  explainFinding,
  ruleBasedClusterKeys,
  ruleBasedCommitRisk,
  ruleBasedEmbeddings,
} from '../src/services/ml.client.js'
import type { CommitFacts, FindingFacts } from '../src/services/ml.client.js'

const baseFacts: CommitFacts = {
  message: 'feat: add search',
  files: [],
  additions: 0,
  deletions: 0,
  testsAffected: [],
  hotspots: [],
}

const riskyFacts: CommitFacts = {
  message: 'fix: patch session handling',
  files: Array.from({ length: 12 }, (_, i) => ({
    path: `src/auth/session-${i}.ts`,
    change: 'modified' as const,
    additions: 30,
    deletions: 30,
  })),
  additions: 400,
  deletions: 400,
  testsAffected: ['test/session.test.ts'],
  hotspots: ['src/auth/session-0.ts', 'src/auth/session-1.ts', 'src/auth/session-2.ts'],
}

describe('commit risk scoring (deterministic stub)', () => {
  it('maps scores to levels at the documented boundaries', () => {
    expect(commitRiskLevel(0.7)).toBe('high')
    expect(commitRiskLevel(0.69)).toBe('medium')
    expect(commitRiskLevel(0.4)).toBe('medium')
    expect(commitRiskLevel(0.39)).toBe('low')
  })

  it('scores an inert commit at zero', () => {
    const risk = ruleBasedCommitRisk(baseFacts)
    expect(risk.score).toBe(0)
    expect(risk.level).toBe('low')
    expect(risk.signals).toHaveLength(0)
    expect(risk.suggestedAction).toContain('No action required')
  })

  it('accumulates file, churn, hotspot, sensitivity, test and fix weights', () => {
    const risk = ruleBasedCommitRisk(riskyFacts)
    // 0.18 (files) + 0.22 (churn) + 0.16 (hotspots) + 0.25 (auth paths) + 0.10 (tests) + 0.08 (fix:)
    expect(risk.score).toBeCloseTo(0.99, 2)
    expect(risk.level).toBe('high')
    expect(risk.suggestedAction).toContain('Run verification on this commit before shipping')
    const labels = risk.signals.map((signal) => signal.label)
    expect(labels).toContain('Sensitive area touched')
    expect(labels.some((label) => label.includes('12 files touched'))).toBe(true)
    expect(labels).toContain('Hotspot files touched')
  })

  it('treats reverts as riskier than fixes and chores as de-risking', () => {
    const revert = ruleBasedCommitRisk({ ...baseFacts, message: 'revert: undo search', files: riskyFacts.files.slice(0, 1) })
    const fix = ruleBasedCommitRisk({ ...baseFacts, message: 'fix: undo search', files: riskyFacts.files.slice(0, 1) })
    const chore = ruleBasedCommitRisk({ ...baseFacts, message: 'chore: bump deps', files: riskyFacts.files.slice(0, 1) })
    expect(revert.score).toBeGreaterThan(fix.score)
    expect(fix.score).toBeGreaterThanOrEqual(chore.score)
    expect(chore.signals.map((s) => s.label)).toContain('Low-risk change type')
  })

  it('clamps the score into 0..1', () => {
    const maxed = ruleBasedCommitRisk(riskyFacts)
    expect(maxed.score).toBeLessThanOrEqual(1)
    expect(maxed.score).toBeGreaterThanOrEqual(0)
  })

  it('falls back to the rule engine while ML_ENABLED is false', async () => {
    await expect(commitRisk(baseFacts)).resolves.toEqual(ruleBasedCommitRisk(baseFacts))
  })
})

describe('embedding + clustering stubs', () => {
  it('produces deterministic 32-dim rule-based embeddings', () => {
    const [a1, a2] = ruleBasedEmbeddings(['same text', 'same text'])
    const [b] = ruleBasedEmbeddings(['different text'])
    expect(a1).toHaveLength(32)
    expect(a1).toEqual(a2)
    expect(a1).not.toEqual(b)
    expect(a1?.every((value) => value >= -1 && value <= 1)).toBe(true)
  })

  const facts = (overrides: Partial<FindingFacts>): FindingFacts => ({
    id: 'f1',
    title: 't',
    category: 'security',
    severity: 'high',
    evidenceIds: ['e1'],
    evidenceKinds: ['log'],
    fixSteps: [],
    ...overrides,
  })

  it('groups by category + concrete location', async () => {
    const group = [
      facts({ id: 'a', filePath: 'src/aws.mjs' }),
      facts({ id: 'b', filePath: 'src/aws.mjs' }),
      facts({ id: 'c', filePath: 'src/other.mjs' }),
      facts({ id: 'd', category: 'database', filePath: 'src/aws.mjs' }),
    ]
    const keys = ruleBasedClusterKeys(group)
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[0])
    expect(keys[3]).not.toBe(keys[0])
    await expect(clusterFindings(group)).resolves.toEqual(keys)
  })

  it('falls back through endpoint, table and title for the cluster key', () => {
    expect(ruleBasedClusterKeys([facts({ endpoint: 'GET /x' })])[0]).toBe('security|GET /x')
    expect(ruleBasedClusterKeys([facts({ table: 'users' })])[0]).toBe('security|users')
    expect(ruleBasedClusterKeys([facts({ title: 'Mixed Case' })])[0]).toBe('security|mixed case')
  })
})

describe('explanation stub', () => {
  it('keeps deterministic text and cites only the finding itself', async () => {
    const explanation = await explainFinding({
      id: 'f1',
      title: 'Unprotected route',
      category: 'security',
      severity: 'critical',
      filePath: 'server.mjs',
      endpoint: 'GET /admin',
      evidenceIds: ['e1', 'e2'],
      evidenceKinds: ['http'],
      whyItMatters: 'Anyone can reach the admin surface.',
      fixSteps: ['Attach auth middleware'],
    })
    expect(explanation.whyItMatters).toBe('Anyone can reach the admin surface.')
    expect(explanation.fixSteps).toEqual(['Attach auth middleware'])
    expect(explanation.citedEvidenceIds).toEqual(['e1', 'e2'])
    expect(explanation.citedFilePaths).toEqual(['server.mjs'])
  })

  it('templates an explanation when the check authored none', async () => {
    const explanation = await explainFinding({
      id: 'f2',
      title: 'Missing column',
      category: 'database',
      severity: 'medium',
      table: 'posts',
      evidenceIds: ['e9'],
      evidenceKinds: ['log'],
      fixSteps: [],
    })
    expect(explanation.whyItMatters).toContain('medium-severity database problem')
    expect(explanation.whyItMatters).toContain('posts')
    expect(explanation.fixSteps.length).toBeGreaterThanOrEqual(2)
    expect(explanation.citedFilePaths).toEqual([])
  })
})
