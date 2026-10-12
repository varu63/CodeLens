import { listChecksForRun } from '../db/queries/checks.queries.js'
import { listFindingsForRun } from '../db/queries/findings.queries.js'
import { findProjectById } from '../db/queries/projects.queries.js'
import type { ApiLoadTestResult } from '../utils/mappers.js'
import { notFound } from '../utils/errors.js'
import { getLoadTestForUser, getRunForUser } from './runs.service.js'

/**
 * Machine-readable run report + a minimal printable PDF. Everything here is
 * assembled from stored, deterministic results — the ONLY AI-touched line is
 * the executive summary, which merely restates them.
 */

export type ReportFormat = 'json' | 'pdf'

export interface RunReportJson {
  schemaVersion: 1
  generatedAt: string
  product: 'ProofLoop'
  executiveSummary: string
  run: {
    id: string
    project: string
    status: string
    trigger: string
    healthScore: number | null
    startedAt: string
    finishedAt?: string
    durationMs?: number
    loadUsers: number
  }
  project: { id: string; name: string; source: string; stack: unknown } | null
  checks: {
    total: number
    passed: number
    failed: number
    failedChecks: Array<{ name: string; command: string | null; message: string | null }>
  }
  findings: Array<{
    id: string
    severity: string
    category: string
    title: string
    filePath: string | null
    confidence: number
    evidenceValidated: boolean
    clusterId: string | null
  }>
  loadTest: ApiLoadTestResult | null
  notTested: string[]
}

export type ReportResult =
  | { kind: 'json'; report: RunReportJson }
  | { kind: 'pdf'; buffer: Buffer; filename: string }

// TODO(ml): replace this template summary with an LLM-written executive summary
// (small instruct model) served at ML_SERVICE_URL /ml/summarise; it may only
// restate the deterministic results below, never invent new claims.
function executiveSummary(
  projectName: string,
  status: string,
  healthScore: number | null,
  passed: number,
  total: number,
  severity: { critical: number; high: number; medium: number; low: number },
): string {
  const counts = Object.entries(severity)
    .filter(([, count]) => count > 0)
    .map(([level, count]) => `${count} ${level}`)
    .join(', ')
  const findingsPart = counts ? `Findings: ${counts}.` : 'No findings were recorded.'
  return `${projectName} verification ${status}: ${passed}/${total} checks passed with a health score of ${healthScore ?? '-'} / 100. ${findingsPart} Tests decide pass/fail; AI explanations are validated against captured evidence.`
}

export async function buildRunReportForUser(
  userId: string,
  runId: string,
  format: ReportFormat,
): Promise<ReportResult> {
  const run = await getRunForUser(userId, runId)
  const [project, checksList, findingsList] = await Promise.all([
    findProjectById(run.projectId),
    listChecksForRun(runId, { limit: 100, offset: 0 }),
    listFindingsForRun(runId, { limit: 1000, offset: 0 }),
  ])
  if (!project) throw notFound('Run not found')

  const checks = checksList.rows
  const findings = findingsList.rows.map((row) => ({
    id: row.id,
    severity: row.severity,
    category: row.category,
    title: row.title,
    filePath: row.filePath,
    confidence: row.confidence ?? 1,
    evidenceValidated: row.explained,
    clusterId: row.clusterId,
  }))

  const severity = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const finding of findings) severity[finding.severity as keyof typeof severity] += 1
  const passed = checks.filter((check) => check.status === 'passed').length
  const failed = checks.filter((check) => check.status === 'failed').length

  const loadTest = await getLoadTestForUser(userId, runId)
  const loadTestPayload = loadTest.routes.length > 0 ? loadTest : null

  const notTested = [...new Set(findingsList.rows.flatMap((row) => row.notTested))].slice(0, 20)

  const report: RunReportJson = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    product: 'ProofLoop',
    executiveSummary: executiveSummary(project.name, run.status, run.healthScore, passed, checks.length, severity),
    run: {
      id: run.id,
      project: run.projectName,
      status: run.status,
      trigger: run.trigger,
      healthScore: run.healthScore,
      startedAt: run.startedAt,
      ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
      ...(run.durationMs !== undefined ? { durationMs: run.durationMs } : {}),
      loadUsers: run.loadUsers,
    },
    project: { id: project.id, name: project.name, source: project.source, stack: project.detectedStack },
    checks: {
      total: checks.length,
      passed,
      failed,
      failedChecks: checks
        .filter((check) => check.status === 'failed')
        .map((check) => ({ name: check.name, command: check.command, message: check.message })),
    },
    findings,
    loadTest: loadTestPayload,
    notTested,
  }

  if (format === 'json') return { kind: 'json', report }
  return { kind: 'pdf', buffer: renderReportPdf(report), filename: `proofloop-run-${runId}.pdf` }
}

/* ---------------------------------- PDF ------------------------------------ */

function escapePdfText(value: string): string {
  return value.replace(/[\\()]/g, (match) => `\\${match}`).replace(/[^\x20-\x7E]/g, '?')
}

function wrapLine(text: string, width = 88): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current && (current + ` ${word}`).length > width) {
      lines.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) lines.push(current)
  return lines
}

/** Minimal, valid one-page PDF with Helvetica text — enough for real viewers. */
function buildPdf(lines: string[]): Buffer {
  const content = [
    'BT',
    '/F1 11 Tf',
    '16 TL',
    '54 730 Td',
    ...lines.flatMap((line) => [`(${escapePdfText(line)}) Tj`, 'T']),
    'ET',
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(pdf, 'utf8')
}

function renderReportPdf(report: RunReportJson): Buffer {
  const { run, checks } = report
  const lines = [
    'PROOFLOOP VERIFICATION REPORT',
    '='.repeat(46),
    `Run:          ${run.id}`,
    `Project:      ${run.project}`,
    `Status:       ${run.status.toUpperCase()}   Health score: ${run.healthScore ?? '-'} / 100`,
    `Trigger:      ${run.trigger}   Load target: ${run.loadUsers} users`,
    `Started:      ${run.startedAt}`,
    `Finished:     ${run.finishedAt ?? '-'}${run.durationMs !== undefined ? `   Duration: ${Math.round(run.durationMs / 1000)}s` : ''}`,
    `Checks:       ${checks.passed} passed, ${checks.failed} failed of ${checks.total}`,
    '',
    'SUMMARY',
    ...wrapLine(report.executiveSummary),
    '',
    'FINDINGS',
    ...(report.findings.length > 0
      ? report.findings.map(
          (finding) => `  [${finding.severity.toUpperCase()}] ${finding.title} (confidence ${(finding.confidence * 100).toFixed(0)}%)`,
        )
      : ['  none']),
    '',
    'NOT TESTED',
    ...(report.notTested.length > 0 ? report.notTested.slice(0, 12).map((item) => `  - ${item}`) : ['  nothing recorded']),
    '',
    'Tests decide PASS/FAIL. AI explanations were reviewed against captured evidence.',
  ]
  return buildPdf(lines)
}
