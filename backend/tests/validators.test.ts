import { describe, expect, it } from 'vitest'
import { feedbackSchema, findingIdParamSchema, listFindingsQuerySchema } from '../src/validators/findings.validators.js'
import {
  reportQuerySchema,
  sendToAgentSchema,
  startRunSchema,
} from '../src/validators/runs.validators.js'

describe('startRunSchema', () => {
  it('accepts a full configuration', () => {
    const parsed = startRunSchema.parse({
      loadUsers: 250,
      checks: ['structure', 'security'],
      commit: 'abc1234',
    })
    expect(parsed.loadUsers).toBe(250)
    expect(parsed.checks).toEqual(['structure', 'security'])
  })

  it('accepts an empty object (all stages, project defaults)', () => {
    expect(startRunSchema.parse({})).toEqual({})
  })

  it('rejects unknown check types, empty check lists, bad shas and extra keys', () => {
    expect(startRunSchema.safeParse({ checks: ['nope'] }).success).toBe(false)
    expect(startRunSchema.safeParse({ checks: [] }).success).toBe(false)
    expect(startRunSchema.safeParse({ commit: 'xyz' }).success).toBe(false)
    expect(startRunSchema.safeParse({ commit: 'abc' }).success).toBe(false)
    expect(startRunSchema.safeParse({ extra: true }).success).toBe(false)
  })
})

describe('sendToAgentSchema', () => {
  const id = '00000000-0000-4000-8000-000000000001'

  it('accepts known agents with 1..50 uuid findings', () => {
    expect(sendToAgentSchema.parse({ agent: 'claude_code', findingIds: [id] }).agent).toBe('claude_code')
    expect(sendToAgentSchema.safeParse({ agent: 'codex', findingIds: [id, id] }).success).toBe(true)
  })

  it('rejects unknown agents, empty or oversized lists and non-uuids', () => {
    expect(sendToAgentSchema.safeParse({ agent: 'gpt4', findingIds: [id] }).success).toBe(false)
    expect(sendToAgentSchema.safeParse({ agent: 'aider', findingIds: [] }).success).toBe(false)
    expect(sendToAgentSchema.safeParse({ agent: 'aider', findingIds: ['not-a-uuid'] }).success).toBe(false)
    expect(
      sendToAgentSchema.safeParse({ agent: 'aider', findingIds: Array.from({ length: 51 }, () => id) }).success,
    ).toBe(false)
    expect(sendToAgentSchema.safeParse({ agent: 'aider', findingIds: [id], extra: 1 }).success).toBe(false)
  })
})

describe('reportQuerySchema', () => {
  it('defaults to json and rejects unknown formats', () => {
    expect(reportQuerySchema.parse({}).format).toBe('json')
    expect(reportQuerySchema.parse({ format: 'pdf' }).format).toBe('pdf')
    expect(reportQuerySchema.safeParse({ format: 'xml' }).success).toBe(false)
  })
})

describe('feedbackSchema', () => {
  it('requires both booleans and bounds the comment', () => {
    expect(feedbackSchema.parse({ useful: true, fixCorrect: false }).comment).toBeUndefined()
    expect(feedbackSchema.safeParse({ useful: true }).success).toBe(false)
    expect(feedbackSchema.safeParse({ useful: 'yes', fixCorrect: true }).success).toBe(false)
    expect(feedbackSchema.safeParse({ useful: true, fixCorrect: true, comment: 'x'.repeat(2001) }).success).toBe(false)
    expect(feedbackSchema.safeParse({ useful: true, fixCorrect: true, extra: 1 }).success).toBe(false)
  })

  it('trims comment whitespace', () => {
    expect(feedbackSchema.parse({ useful: true, fixCorrect: true, comment: '  hi  ' }).comment).toBe('hi')
  })
})

describe('findingIdParamSchema', () => {
  it('requires a uuid', () => {
    expect(findingIdParamSchema.safeParse({ findingId: '00000000-0000-4000-8000-000000000001' }).success).toBe(true)
    expect(findingIdParamSchema.safeParse({ findingId: 'nope' }).success).toBe(false)
  })
})

describe('listFindingsQuerySchema', () => {
  it('coerces pagination and keeps filters optional', () => {
    const parsed = listFindingsQuerySchema.parse({ page: '2', limit: '10', severity: 'high' })
    expect(parsed.page).toBe(2)
    expect(parsed.limit).toBe(10)
    expect(parsed.severity).toBe('high')
  })

  it('rejects unknown severities and categories', () => {
    expect(listFindingsQuerySchema.safeParse({ severity: 'urgent' }).success).toBe(false)
    expect(listFindingsQuerySchema.safeParse({ category: 'vibes' }).success).toBe(false)
  })
})
