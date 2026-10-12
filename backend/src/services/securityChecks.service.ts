import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { ensureImage, runInSandbox, runToolContainer } from './sandbox.service.js'

export interface SecurityToolIssue {
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  message: string
  file?: string
  line?: number
}

export interface SecurityToolOutcome {
  tool: 'semgrep' | 'gitleaks' | 'npm-audit'
  ran: boolean
  /** Short human note: what ran, what was skipped and why. */
  note: string
  issues: SecurityToolIssue[]
  /** Sanitized JSON document for the artifact (never contains secrets). */
  reportJson: string
}

const SEMGREP_IMAGE = 'semgrep/semgrep:latest'
const GITLEAKS_IMAGES = ['ghcr.io/gitleaks/gitleaks:latest', 'zricethezav/gitleaks:latest']
const MAX_SEMGREP_ISSUES = 20
const MAX_GITLEAKS_ISSUES = 20
const MAX_AUDIT_ISSUES = 10

const SEMGREP_EXCLUDES = ['node_modules', 'dist', 'build', 'coverage', '.git', 'vendor']

function parseJsonLoosely(text: string): unknown {
  const start = text.indexOf('{')
  if (start === -1) {
    const arrayStart = text.indexOf('[')
    if (arrayStart === -1) return null
    try {
      return JSON.parse(text.slice(arrayStart))
    } catch {
      return null
    }
  }
  try {
    return JSON.parse(text.slice(start))
  } catch {
    return null
  }
}

/** Static analysis for common security bugs. Offline results also count. */
export async function runSemgrep(workspace: string): Promise<SecurityToolOutcome> {
  const empty = (note: string): SecurityToolOutcome => ({
    tool: 'semgrep',
    ran: false,
    note,
    issues: [],
    reportJson: JSON.stringify({ available: false, note }, null, 2),
  })
  if (!existsSync(workspace)) return empty('workspace missing')

  let image: string | null = null
  if (await ensureImage(SEMGREP_IMAGE)) image = SEMGREP_IMAGE
  if (!image) return empty('could not obtain the semgrep image')

  // `--config auto` refuses to run with metrics disabled; p/default is the
  // pinned curated registry ruleset that works offline-of-telemetry.
  const args = ['semgrep', 'scan', '--config', 'p/default', '--json', '--metrics', 'off', '--quiet', '--timeout', '30']
  for (const exclude of SEMGREP_EXCLUDES) args.push('--exclude', exclude)
  args.push('/src')

  const result = await runToolContainer({
    image,
    cmd: args,
    mounts: [{ hostPath: workspace, containerPath: '/src', readOnly: true }],
    network: 'bridge', // needed for `--config auto` rule rules from the registry
    timeoutSec: 300,
  })
  if (!result.ran) return empty(result.error ?? 'semgrep did not run')

  const parsed = parseJsonLoosely(result.stdout) as {
    results?: Array<{
      check_id?: string
      path?: string
      start?: { line?: number }
      extra?: { message?: string; severity?: string }
    }>
  } | null

  if (!parsed || !Array.isArray(parsed.results)) {
    return empty(`semgrep produced no parseable output (exit ${result.exitCode})`)
  }

  const severityOf = (value: string | undefined): SecurityToolIssue['severity'] => {
    switch ((value ?? '').toUpperCase()) {
      case 'ERROR':
        return 'high'
      case 'WARNING':
        return 'medium'
      default:
        return 'low'
    }
  }

  const issues: SecurityToolIssue[] = parsed.results.slice(0, MAX_SEMGREP_ISSUES).map((finding) => {
    const ruleId = finding.check_id ?? 'unknown-rule'
    const file = (finding.path ?? '').replace(/^\/src\/?/, '')
    return {
      severity: severityOf(finding.extra?.severity),
      title: `Semgrep: ${ruleId}`,
      message: (finding.extra?.message ?? 'Static analysis finding').split('\n')[0] ?? 'Static analysis finding',
      ...(file ? { file } : {}),
      ...(finding.start?.line ? { line: finding.start.line } : {}),
    }
  })

  const report = {
    available: true,
    totalFindings: parsed.results.length,
    shown: issues.length,
    issues: issues.map((issue) => ({ ...issue, tool: 'semgrep' })),
  }
  const note =
    issues.length === 0
      ? 'semgrep: no findings'
      : `semgrep: ${parsed.results.length} finding(s) (${issues.filter((issue) => issue.severity === 'high').length} at error severity)`
  return { tool: 'semgrep', ran: true, note, issues, reportJson: JSON.stringify(report, null, 2) }
}

/**
 * Secret scanning. The report is deliberately read without the `Secret` /
 * `Match` fields — raw secret material must never reach logs, artifacts or
 * the database. `--redact` is still passed as belt-and-braces.
 */
export async function runGitleaks(workspace: string, outputDir: string): Promise<SecurityToolOutcome> {
  const empty = (note: string): SecurityToolOutcome => ({
    tool: 'gitleaks',
    ran: false,
    note,
    issues: [],
    reportJson: JSON.stringify({ available: false, note }, null, 2),
  })
  if (!existsSync(workspace)) return empty('workspace missing')

  let image: string | null = null
  for (const candidate of GITLEAKS_IMAGES) {
    if (await ensureImage(candidate)) {
      image = candidate
      break
    }
  }
  if (!image) return empty('could not obtain the gitleaks image')

  // Installed dependencies (node_modules) are not the user's code — default
  // ruleset + explicit path allowlist keeps the scan focused on the source.
  const configPath = path.join(outputDir, 'gitleaks.toml')
  writeFileSync(
    configPath,
    [
      '[extend]',
      'useDefault = true',
      '',
      '[allowlist]',
      "description = \"ignore installed dependencies and build output\"",
      "paths = ['''node_modules''', '''dist''', '''build''', '''coverage''', '''\\.git''']",
      '',
    ].join('\n'),
  )

  const result = await runToolContainer({
    image,
    cmd: [
      'gitleaks',
      'detect',
      '--source',
      '/src',
      '--config',
      '/out/gitleaks.toml',
      '--no-git',
      '--report-format',
      'json',
      '--report-path',
      '/out/gitleaks.json',
      '--redact',
      '--exit-code',
      '0',
    ],
    mounts: [
      { hostPath: workspace, containerPath: '/src', readOnly: true },
      { hostPath: outputDir, containerPath: '/out' },
    ],
    network: 'none',
    timeoutSec: 240,
  })
  if (!result.ran) return empty(result.error ?? 'gitleaks did not run')

  const reportPath = path.join(outputDir, 'gitleaks.json')
  let leaks: Array<{ RuleID?: string; File?: string; StartLine?: number; Description?: string }> = []
  try {
    const parsed = JSON.parse(readFileSync(reportPath, 'utf8')) as unknown
    if (Array.isArray(parsed)) leaks = parsed as typeof leaks
  } catch {
    // no report file — treat as no findings, note the exit code
  }

  const issues: SecurityToolIssue[] = leaks.slice(0, MAX_GITLEAKS_ISSUES).map((leak) => ({
    severity: 'critical' as const,
    title: `Exposed secret: ${leak.RuleID ?? 'unknown-rule'}`,
    message: `${leak.Description ?? 'Potential secret detected'} — value redacted, rotate it if it is real`,
    ...(leak.File ? { file: leak.File.replace(/^\/src\/?/, '') } : {}),
    ...(leak.StartLine ? { line: leak.StartLine } : {}),
  }))

  const report = {
    available: true,
    totalFindings: leaks.length,
    shown: issues.length,
    issues: issues.map((issue) => ({ ...issue, tool: 'gitleaks' })),
  }
  const note = issues.length === 0 ? 'gitleaks: no secrets found' : `gitleaks: ${leaks.length} potential secret(s) — values redacted`
  return { tool: 'gitleaks', ran: true, note, issues, reportJson: JSON.stringify(report, null, 2) }
}

/** Dependency audit via `npm audit` inside the sandbox (needs the registry). */
export async function runNpmAudit(workspace: string): Promise<SecurityToolOutcome> {
  const empty = (note: string): SecurityToolOutcome => ({
    tool: 'npm-audit',
    ran: false,
    note,
    issues: [],
    reportJson: JSON.stringify({ available: false, note }, null, 2),
  })

  if (!existsSync(path.join(workspace, 'package.json'))) return empty('no package.json')
  if (
    !existsSync(path.join(workspace, 'package-lock.json')) &&
    !existsSync(path.join(workspace, 'npm-shrinkwrap.json'))
  ) {
    return empty('no lockfile to audit')
  }

  const result = await runInSandbox({
    workspaceDir: workspace,
    command: 'npm audit --json || true',
    network: 'bridge', // advisory database lookup
    timeoutSec: 240,
  })
  if (!result.ran) return empty(result.error ?? 'sandbox unavailable')

  const parsed = parseJsonLoosely(result.stdout) as {
    metadata?: { vulnerabilities?: Record<string, number> }
    vulnerabilities?: Record<
      string,
      { severity?: string; range?: string; via?: Array<{ title?: string; severity?: string } | string> }
    >
  } | null
  if (!parsed || !parsed.metadata?.vulnerabilities || !parsed.vulnerabilities) {
    return empty(`npm audit produced no parseable report (exit ${result.exitCode})`)
  }

  const counts = parsed.metadata.vulnerabilities
  const severityOf = (value: string | undefined): SecurityToolIssue['severity'] => {
    switch (value) {
      case 'critical':
        return 'critical'
      case 'high':
        return 'high'
      case 'moderate':
        return 'medium'
      default:
        return 'low'
    }
  }

  const issues: SecurityToolIssue[] = []
  for (const [name, entry] of Object.entries(parsed.vulnerabilities)) {
    const severity = severityOf(entry.severity)
    if (severity !== 'critical' && severity !== 'high') continue
    const via = (entry.via ?? []).find((item) => typeof item !== 'string')
    issues.push({
      severity,
      title: `Vulnerable dependency: ${name}`,
      message: `\`${name}\` ${entry.range ?? ''} has a ${entry.severity ?? 'known'} vulnerability${
        via && typeof via !== 'string' && via.title ? ` — ${via.title}` : ''
      }`.trim(),
    })
    if (issues.length >= MAX_AUDIT_ISSUES) break
  }

  const report = {
    available: true,
    counts,
    issues: issues.map((issue) => ({ ...issue, tool: 'npm-audit' })),
  }
  const problemCount = (counts.critical ?? 0) + (counts.high ?? 0)
  const note =
    problemCount === 0
      ? `npm audit: no high/critical advisories (${counts.total ?? 0} total)`
      : `npm audit: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high advisories`
  return { tool: 'npm-audit', ran: true, note, issues, reportJson: JSON.stringify(report, null, 2) }
}
