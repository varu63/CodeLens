import { createHash } from 'node:crypto'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

/**
 * All ML/LLM calls go through this file. When ML_ENABLED=false (the default)
 * every function falls back to a deterministic rule-based stub so the product
 * works end to end; when true the Python service is called with the service
 * key. Models never decide pass/fail — they only group, score, rank, explain.
 */

export interface CommitFileFact {
  path: string
  change: 'added' | 'modified' | 'deleted' | 'renamed'
  additions: number
  deletions: number
}

export interface CommitFacts {
  message: string
  files: CommitFileFact[]
  additions: number
  deletions: number
  testsAffected: string[]
  /** Files that have changed repeatedly across the analysed history window. */
  hotspots: string[]
}

export interface RiskSignal {
  label: string
  description: string
  weight?: number
}

export interface CommitRiskResult {
  /** 0..1 — the wire layer scales this to 0..100. */
  score: number
  level: 'low' | 'medium' | 'high'
  signals: RiskSignal[]
  /** Rule-derived next step shown as the commit's suggested action. */
  suggestedAction: string
}

/** Paths that historically correlate with incidents: auth, contracts, config. */
const SENSITIVE_PATH_RE =
  /(^|\/)(auth|middleware|validators?|guards?|schema|migrations?|routes?|controllers?|api)(\/|$)|(^|\/)\.env|config/i

/** Shared score→level mapping so stored scores and wire levels never diverge. */
export function commitRiskLevel(score: number): CommitRiskResult['level'] {
  if (score >= 0.7) return 'high'
  if (score >= 0.4) return 'medium'
  return 'low'
}

function clamp01(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100
}

// TODO(ml): replace this rule-based weighted score with a logistic-regression / XGBoost
// model served at ML_SERVICE_URL /ml/commit-risk once labelled data exists.
export function ruleBasedCommitRisk(facts: CommitFacts): CommitRiskResult {
  const signals: RiskSignal[] = []
  let score = 0

  const fileWeight = Math.min(facts.files.length / 12, 1) * 0.18
  if (fileWeight > 0) {
    signals.push({
      label: `${facts.files.length} file${facts.files.length === 1 ? '' : 's'} touched`,
      description: 'More files in one change means a wider blast radius if something regresses.',
      weight: clamp01(fileWeight),
    })
    score += fileWeight
  }

  const churn = facts.additions + facts.deletions
  const churnWeight = Math.min(churn / 800, 1) * 0.22
  if (churn > 0) {
    signals.push({
      label: `${churn} lines changed`,
      description: `Larger diffs (+${facts.additions}/−${facts.deletions}) are harder to review and more likely to hide a defect.`,
      weight: clamp01(churnWeight),
    })
    score += churnWeight
  }

  const hotspotWeight = Math.min(facts.hotspots.length / 3, 1) * 0.16
  if (facts.hotspots.length > 0) {
    signals.push({
      label: 'Hotspot files touched',
      description: `${facts.hotspots.slice(0, 3).join(', ')} changed repeatedly across recent commits.`,
      weight: clamp01(hotspotWeight),
    })
    score += hotspotWeight
  }

  const sensitive = facts.files.filter((file) => SENSITIVE_PATH_RE.test(file.path))
  if (sensitive.length > 0) {
    signals.push({
      label: 'Sensitive area touched',
      description: `Touches ${sensitive
        .slice(0, 3)
        .map((file) => file.path)
        .join(', ')} — auth, validation or API-contract surface.`,
      weight: 0.25,
    })
    score += 0.25
  }

  if (facts.testsAffected.length > 0) {
    signals.push({
      label: 'Tests moved with the change',
      description: `${facts.testsAffected.length} test file${facts.testsAffected.length === 1 ? '' : 's'} changed alongside the code — verify they still prove the behavior.`,
      weight: 0.1,
    })
    score += 0.1
  }

  if (/^revert/i.test(facts.message)) {
    signals.push({ label: 'Revert commit', description: 'Reversing a previous change can reintroduce the issue it fixed.', weight: 0.15 })
    score += 0.15
  } else if (/^hotfix/i.test(facts.message) || /^fix(\(|:|!)/i.test(facts.message)) {
    signals.push({ label: 'Bug-fix change', description: 'Fixes tend to be urgent and less reviewed.', weight: 0.08 })
    score += 0.08
  } else if (/^(chore|docs|style|test)(\(|:|!)/i.test(facts.message)) {
    signals.push({ label: 'Low-risk change type', description: 'Chore/docs/test commits rarely alter runtime behavior.', weight: 0 })
    score -= 0.06
  }

  const finalScore = clamp01(score)
  const level = commitRiskLevel(finalScore)
  const topSignal = signals.find((signal) => (signal.weight ?? 0) > 0)
  const focus = topSignal ? ` Biggest factor: ${topSignal.label.toLowerCase()}.` : ''

  const suggestedAction =
    level === 'high'
      ? `Review carefully before merging.${focus} Run verification on this commit before shipping.`
      : level === 'medium'
        ? `Standard review, then verify with a run —${focus || ' no single dominant factor.'}`
        : 'No action required beyond the normal review.'

  return { score: finalScore, level, signals, suggestedAction }
}

/** POST helper shared by every ML call: JSON in, JSON out, hard timeout. */
async function mlPost<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(`${env.ML_SERVICE_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.ML_SERVICE_KEY ? { Authorization: `Bearer ${env.ML_SERVICE_KEY}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`ML service answered ${response.status}`)
  return (await response.json()) as T
}

/**
 * Commit risk score + signals. With ML_ENABLED=true the Python service is
 * asked first; any failure falls back to the deterministic rule engine so a
 * run never loses its risk data.
 */
export async function commitRisk(facts: CommitFacts): Promise<CommitRiskResult> {
  if (env.ML_ENABLED) {
    try {
      const parsed = await mlPost<Partial<CommitRiskResult>>('/ml/commit-risk', facts)
      if (typeof parsed.score !== 'number' || !parsed.level) {
        throw new Error('ML service returned an unexpected payload')
      }
      const score = clamp01(parsed.score)
      return {
        score,
        level: parsed.level,
        signals: Array.isArray(parsed.signals) ? parsed.signals : [],
        suggestedAction: parsed.suggestedAction ?? ruleBasedCommitRisk(facts).suggestedAction,
      }
    } catch (error) {
      logger.warn({ err: error }, 'ML commit-risk call failed — using the rule-based stub')
    }
  }
  return ruleBasedCommitRisk(facts)
}

/* -------------------------- Finding analysis stubs ------------------------- */

export interface FindingFacts {
  /** Wire id of the finding being analysed. */
  id: string
  title: string
  category: string
  severity: string
  filePath?: string
  endpoint?: string
  table?: string
  /** Evidence ref ids already verified to exist at creation time. */
  evidenceIds: string[]
  evidenceKinds: string[]
  /** Text a deterministic check already authored (kept when present). */
  whyItMatters?: string
  fixSteps: string[]
}

export interface FindingExplanation {
  whyItMatters: string
  fixSteps: string[]
  /** Evidence ref ids the text cites — each one must resolve or explained=false. */
  citedEvidenceIds: string[]
  /** Workspace-relative paths the text cites — each one must exist or explained=false. */
  citedFilePaths: string[]
}

export interface EmbeddedText {
  id: string
  vector: number[]
}

// TODO(ml): replace this hashed pseudo-vector with the real embedding model
// (e.g. text-embedding-3-small) served at ML_SERVICE_URL /ml/embed; vectors
// then live in a pgvector table (see 001_init.sql) so findings cluster by
// semantic similarity instead of by path.
export function ruleBasedEmbeddings(texts: string[], dims = 32): number[][] {
  return texts.map((text) => {
    const digest = createHash('sha256').update(text).digest()
    return Array.from({ length: dims }, (_, i) => (digest[i % digest.length]! - 127.5) / 127.5)
  })
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (env.ML_ENABLED) {
    try {
      const parsed = await mlPost<{ vectors?: number[][] }>('/ml/embed', { texts })
      if (!Array.isArray(parsed.vectors) || parsed.vectors.length !== texts.length) {
        throw new Error('ML service returned an unexpected payload')
      }
      return parsed.vectors
    } catch (error) {
      logger.warn({ err: error }, 'ML embed call failed — using the hashed stub')
    }
  }
  return ruleBasedEmbeddings(texts)
}

/**
 * Root-cause grouping key per finding: findings sharing a category and a
 * concrete location (file, endpoint or table) are treated as one cluster.
 */
function clusterKey(facts: FindingFacts): string {
  const location = facts.filePath ?? facts.endpoint ?? facts.table ?? facts.title.toLowerCase()
  return `${facts.category}|${location}`
}

// TODO(ml): replace this category+location grouping with cosine clustering
// over embedTexts() vectors served at ML_SERVICE_URL /ml/cluster (pgvector).
export function ruleBasedClusterKeys(facts: FindingFacts[]): string[] {
  return facts.map(clusterKey)
}

/** One group key per finding; identical keys mean one root cause. */
export async function clusterFindings(facts: FindingFacts[]): Promise<string[]> {
  if (env.ML_ENABLED) {
    try {
      const parsed = await mlPost<{ groups?: string[] }>('/ml/cluster', { findings: facts })
      if (!Array.isArray(parsed.groups) || parsed.groups.length !== facts.length) {
        throw new Error('ML service returned an unexpected payload')
      }
      return parsed.groups.map((group, index) => group || ruleBasedClusterKeys(facts)[index]!)
    } catch (error) {
      logger.warn({ err: error }, 'ML cluster call failed — using the rule-based stub')
    }
  }
  return ruleBasedClusterKeys(facts)
}

function templateWhyItMatters(facts: FindingFacts): string {
  const where = facts.filePath
    ? ` in \`${facts.filePath}\``
    : facts.endpoint
      ? ` at \`${facts.endpoint}\``
      : facts.table
        ? ` on table \`${facts.table}\``
        : ''
  return `This ${facts.severity}-severity ${facts.category} problem${where} was proven by evidence captured during this run. Left unchecked it can break behavior in production and will not be caught by the existing checks.`
}

function templateFixSteps(facts: FindingFacts): string[] {
  const steps: string[] = []
  if (facts.filePath) steps.push(`Open ${facts.filePath} and address the reported problem`)
  if (facts.endpoint) steps.push(`Reproduce ${facts.endpoint} and confirm the fix against the captured response`)
  if (facts.table) steps.push(`Fix the schema/mapping for ${facts.table} and re-run the database checks`)
  if (steps.length === 0) steps.push('Reproduce the problem locally using the linked evidence')
  steps.push('Re-run the verification to confirm the finding is gone')
  return steps
}

// TODO(ml): replace this rule-based explanation with an LLM call (small instruct
// model) served at ML_SERVICE_URL /ml/explain; the model must return
// { whyItMatters, fixSteps, citedEvidenceIds, citedFilePaths } and every
// citation is validated against stored evidence before the finding keeps
// explained=true.
export async function explainFinding(facts: FindingFacts): Promise<FindingExplanation> {
  if (env.ML_ENABLED) {
    try {
      const parsed = await mlPost<Partial<FindingExplanation>>('/ml/explain', facts)
      if (typeof parsed.whyItMatters !== 'string' || !Array.isArray(parsed.citedEvidenceIds)) {
        throw new Error('ML service returned an unexpected payload')
      }
      return {
        whyItMatters: parsed.whyItMatters,
        fixSteps: Array.isArray(parsed.fixSteps) ? parsed.fixSteps : [],
        citedEvidenceIds: parsed.citedEvidenceIds,
        citedFilePaths: Array.isArray(parsed.citedFilePaths) ? parsed.citedFilePaths : [],
      }
    } catch (error) {
      logger.warn({ err: error }, 'ML explain call failed — using the rule-based stub')
    }
  }
  return {
    whyItMatters: facts.whyItMatters ?? templateWhyItMatters(facts),
    fixSteps: facts.fixSteps.length > 0 ? facts.fixSteps : templateFixSteps(facts),
    citedEvidenceIds: facts.evidenceIds,
    citedFilePaths: facts.filePath ? [facts.filePath] : [],
  }
}
