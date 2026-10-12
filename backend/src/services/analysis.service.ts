import { createHash } from 'node:crypto'
import { listFindingsForRun, updateFindingAnnotation } from '../db/queries/findings.queries.js'
import type { FindingRow } from '../db/queries/findings.queries.js'
import { findStructure } from '../db/queries/structures.queries.js'
import { logger } from '../utils/logger.js'
import { clusterFindings, explainFinding } from './ml.client.js'
import type { FindingExplanation, FindingFacts } from './ml.client.js'

/**
 * Post-finding analysis. Runs right after a finding is persisted:
 *   1. group findings that share a root cause into a cluster id,
 *   2. attach an explanation (LLM when ML_ENABLED, rule-based stub otherwise),
 *   3. validate every citation in that explanation against stored evidence and
 *      the structure map — an unverifiable explanation flips `explained=false`.
 * Golden rule: this layer only groups and explains; it never decides pass/fail,
 * and any failure here keeps the deterministic finding untouched.
 */

/** Deterministic UUID so the same root cause keeps one cluster id across runs. */
export function uuidFromSeed(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function factOf(row: FindingRow): FindingFacts {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    severity: row.severity,
    ...(row.filePath ? { filePath: row.filePath } : {}),
    ...(row.endpoint ? { endpoint: row.endpoint } : {}),
    ...(row.dbTable ? { table: row.dbTable } : {}),
    evidenceIds: row.evidenceIds.map((ref) => ref.id),
    evidenceKinds: [...new Set(row.evidenceCache.map((item) => item.kind))],
    ...(row.whyItMatters ? { whyItMatters: row.whyItMatters } : {}),
    fixSteps: row.fixSteps,
  }
}

/** Workspace-relative paths the structure map knows about (any `file`/`from`). */
export function knownFilePaths(structureData: unknown): Set<string> {
  const paths = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    if (value && typeof value === 'object') {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if ((key === 'file' || key === 'from' || key === 'filePath') && typeof nested === 'string' && nested) {
          paths.add(nested.replace(/^\.\//, ''))
        }
        visit(nested)
      }
    }
  }
  visit(structureData)
  return paths
}

/**
 * An explanation is trusted only when every cited evidence ref belongs to the
 * finding and every cited path is one the scan actually saw. The finding's own
 * file path is authoritative — the deterministic check matched it on disk.
 */
export function validateExplanation(
  explanation: FindingExplanation,
  finding: FindingRow,
  knownPaths: Set<string>,
): boolean {
  const refIds = new Set(finding.evidenceIds.map((ref) => ref.id))
  for (const cited of explanation.citedEvidenceIds) {
    if (!refIds.has(cited)) return false
  }
  const known = new Set(knownPaths)
  if (finding.filePath) known.add(finding.filePath.replace(/^\.\//, ''))
  for (const cited of explanation.citedFilePaths) {
    const normalized = cited.replace(/^\.\//, '')
    if (normalized && !known.has(normalized)) return false
  }
  return true
}

/**
 * Annotates one freshly created finding. Never throws: on any failure the
 * deterministic finding is returned as-is (a run must not depend on the AI).
 */
export async function annotateFinding(finding: FindingRow): Promise<FindingRow> {
  try {
    const [siblings, structure] = await Promise.all([
      listFindingsForRun(finding.runId, { limit: 1000, offset: 0 }),
      findStructure(finding.projectId),
    ])
    const rows = siblings.rows.some((row) => row.id === finding.id)
      ? siblings.rows
      : [...siblings.rows, finding]

    const keys = await clusterFindings(rows.map(factOf))
    const buckets = new Map<string, FindingRow[]>()
    rows.forEach((row, index) => {
      const key = keys[index] ?? factOf(row).id
      const bucket = buckets.get(key)
      if (bucket) bucket.push(row)
      else buckets.set(key, [row])
    })
    const myKey = keys[rows.findIndex((row) => row.id === finding.id)] ?? finding.id
    const bucket = buckets.get(myKey) ?? [finding]
    const clusterId = bucket.length >= 2 ? uuidFromSeed(`${finding.projectId}|cluster|${myKey}`) : null

    const explanation = await explainFinding(factOf(finding))
    const explained = validateExplanation(explanation, finding, knownFilePaths(structure?.data))

    const updated = await updateFindingAnnotation(finding.id, {
      clusterId,
      whyItMatters: explained ? explanation.whyItMatters : (finding.whyItMatters ?? explanation.whyItMatters),
      fixSteps: explanation.fixSteps,
      explained,
    })
    if (!explained) {
      logger.warn({ findingId: finding.id }, 'Explanation cited evidence that does not exist — marked unverified')
    }

    // Backfill the cluster id on siblings grouped before this one arrived.
    if (clusterId) {
      for (const member of bucket) {
        if (member.id === finding.id || member.clusterId === clusterId) continue
        try {
          await updateFindingAnnotation(member.id, {
            clusterId,
            whyItMatters: member.whyItMatters ?? '',
            fixSteps: member.fixSteps,
            explained: member.explained,
          })
        } catch (error) {
          logger.warn({ err: error, findingId: member.id }, 'Could not backfill cluster id')
        }
      }
    }
    return updated
  } catch (error) {
    logger.warn({ err: error, findingId: finding.id }, 'Finding analysis failed — keeping deterministic finding')
    return finding
  }
}
