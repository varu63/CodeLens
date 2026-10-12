import type { Finding } from '../types/domain.types'

export interface ComparisonResult {
  fixed: Finding[]
  stillFailing: Finding[]
  created: Finding[]
}

/**
 * Diffs two runs' findings by their stable fingerprint — no extra endpoint
 * needed. Explicit `comparisonStatus` from the backend wins when present;
 * otherwise membership is derived from the previous run.
 */
export function compareFindings(current: Finding[], previous: Finding[]): ComparisonResult {
  const currentByFp = new Map(current.map((finding) => [finding.fingerprint, finding]))
  const previousByFp = new Map(previous.map((finding) => [finding.fingerprint, finding]))

  const fixed: Finding[] = [
    ...current.filter((finding) => finding.comparisonStatus === 'fixed'),
    ...previous.filter((finding) => !currentByFp.has(finding.fingerprint)),
  ]
  const stillFailing = current.filter((finding) =>
    finding.comparisonStatus
      ? finding.comparisonStatus === 'still_failing'
      : previousByFp.has(finding.fingerprint),
  )
  const created = current.filter((finding) =>
    finding.comparisonStatus ? finding.comparisonStatus === 'new' : !previousByFp.has(finding.fingerprint),
  )

  const unique = (list: Finding[]) => {
    const seen = new Set<string>()
    return list.filter((finding) => {
      if (seen.has(finding.fingerprint)) return false
      seen.add(finding.fingerprint)
      return true
    })
  }

  return { fixed: unique(fixed), stillFailing: unique(stillFailing), created: unique(created) }
}
