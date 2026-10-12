import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import type Docker from 'dockerode'
import { logger } from '../utils/logger.js'
import { dockerClient, ensureImage } from './sandbox.service.js'

const { Client } = pg

const POSTGRES_IMAGE = 'postgres:16-alpine'
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  'vendor',
  'tmp',
  'storage',
])
const MAX_SQL_FILES = 100
const MAX_SQL_BYTES = 2 * 1024 * 1024
const CONNECT_ATTEMPTS = 40
const CONNECT_INTERVAL_MS = 1000

export interface DbCheckIssue {
  kind: 'schema_error' | 'missing_table' | 'missing_column'
  title: string
  message: string
  file?: string
  table?: string
  column?: string
}

export interface DbCheckOutcome {
  status: 'passed' | 'failed' | 'skipped'
  message: string
  issues: DbCheckIssue[]
  /** Full JSON document saved as the check artifact. */
  reportJson: string
  /** Short human-readable summary used as rendered evidence. */
  logExcerpt: string
  durationMs: number
}

async function walkSqlFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || found.length >= MAX_SQL_FILES) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (found.length >= MAX_SQL_FILES) return
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await visit(path.join(dir, entry.name), depth + 1)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) {
        found.push(path.join(dir, entry.name))
      }
    }
  }
  await visit(root, 0)
  return found.sort()
}

interface ScannedTable {
  name: string
  columns: Array<{ name: string; type: string }>
  relations: string[]
}

async function connectWithRetry(port: number, password: string): Promise<pg.Client> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < CONNECT_ATTEMPTS; attempt += 1) {
    const client = new Client({
      host: '127.0.0.1',
      port,
      user: 'proofloop',
      password,
      database: 'proofloop_check',
      connectionTimeoutMillis: 3000,
    })
    try {
      await client.connect()
      return client
    } catch (error) {
      lastError = error
      await client.end().catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, CONNECT_INTERVAL_MS))
    }
  }
  throw new Error(`Could not connect to the check database: ${String(lastError)}`)
}

/**
 * Verification against an isolated, disposable database:
 *  1. spin a throwaway postgres container (tmpfs data dir, resource-limited)
 *  2. apply the project's own .sql files, in path order
 *  3. assert every table/column the structure scan promised actually exists
 *
 * The database never touches the host — it only publishes a loopback port the
 * API process itself connects to. The container is removed afterwards.
 */
export async function runDatabaseCheck(
  workspace: string,
  scannedTables: ScannedTable[],
): Promise<DbCheckOutcome> {
  const startedAt = Date.now()
  const sqlFiles = await walkSqlFiles(workspace)

  if (sqlFiles.length === 0 || scannedTables.length === 0) {
    return {
      status: 'skipped',
      message:
        scannedTables.length === 0
          ? 'No database schema detected (.sql files with CREATE TABLE)'
          : 'No .sql schema files found in the workspace',
      issues: [],
      reportJson: JSON.stringify({ sqlFiles: [], tables: [] }, null, 2),
      logExcerpt: '',
      durationMs: Date.now() - startedAt,
    }
  }

  if (!(await ensureImage(POSTGRES_IMAGE))) {
    return {
      status: 'skipped',
      message: `Could not obtain the ${POSTGRES_IMAGE} image for an isolated database`,
      issues: [],
      reportJson: JSON.stringify({ image: POSTGRES_IMAGE, available: false }, null, 2),
      logExcerpt: '',
      durationMs: Date.now() - startedAt,
    }
  }

  const docker = dockerClient()
  const password = randomBytes(16).toString('hex')
  let container: Docker.Container | null = null
  let client: pg.Client | null = null

  const issues: DbCheckIssue[] = []
  const fileReports: Array<{ file: string; ok: boolean; error?: string }> = []
  let tablesReport: Array<{ name: string; exists: boolean; missingColumns: string[]; missingRelations: string[] }> = []

  try {
    container = await docker.createContainer({
      Image: POSTGRES_IMAGE,
      Env: [
        `POSTGRES_PASSWORD=${password}`,
        'POSTGRES_USER=proofloop',
        'POSTGRES_DB=proofloop_check',
      ],
      ExposedPorts: { '5432/tcp': {} },
      HostConfig: {
        NetworkMode: 'bridge',
        PortBindings: { '5432/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] },
        Memory: 512 * 1024 * 1024,
        NanoCpus: 1_000_000_000,
        PidsLimit: 256,
        Tmpfs: { '/var/lib/postgresql/data': 'rw,size=256m' },
        SecurityOpt: ['no-new-privileges'],
      },
    })
    await container.start()

    const inspect = await container.inspect()
    const portInfo = inspect.NetworkSettings?.Ports?.['5432/tcp']?.[0]
    const hostPort = portInfo?.HostPort ? Number(portInfo.HostPort) : null
    if (!hostPort) throw new Error('Postgres container did not publish a port')

    client = await connectWithRetry(hostPort, password)
    await client.query('SET statement_timeout = 20000')

    for (const file of sqlFiles) {
      const relative = path.relative(workspace, file).split(path.sep).join('/')
      try {
        const stat = await fs.stat(file)
        if (stat.size > MAX_SQL_BYTES) {
          fileReports.push({ file: relative, ok: false, error: `file larger than ${MAX_SQL_BYTES} bytes — skipped` })
          issues.push({
            kind: 'schema_error',
            file: relative,
            title: `Schema error in ${relative}`,
            message: 'Schema file too large to apply',
          })
          continue
        }
        const sql = await fs.readFile(file, 'utf8')
        if (!/\b(CREATE|ALTER|DROP)\b/i.test(sql)) {
          fileReports.push({ file: relative, ok: true })
          continue
        }
        await client.query(sql)
        fileReports.push({ file: relative, ok: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        fileReports.push({ file: relative, ok: false, error: message })
        issues.push({ kind: 'schema_error', file: relative, title: `Schema error in ${relative}`, message })
      }
    }

    const actualTables = new Set(
      (
        await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
        )
      ).rows.map((row) => row.table_name.toLowerCase()),
    )

    tablesReport = []
    for (const table of scannedTables) {
      const name = table.name.toLowerCase()
      const exists = actualTables.has(name)
      const missingColumns: string[] = []
      const missingRelations: string[] = []
      if (exists) {
        const actualColumns = new Set(
          (
            await client.query<{ column_name: string }>(
              `SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = $1`,
              [name],
            )
          ).rows.map((row) => row.column_name.toLowerCase()),
        )
        for (const column of table.columns) {
          if (!actualColumns.has(column.name.toLowerCase())) missingColumns.push(column.name)
        }
      } else {
        issues.push({
          kind: 'missing_table',
          table: table.name,
          title: `Table not created by schema: ${table.name}`,
          message: `Table "${table.name}" was not created by the schema files`,
        })
      }
      for (const relation of table.relations) {
        const target = relation.toLowerCase()
        if (!actualTables.has(target)) {
          missingRelations.push(relation)
          issues.push({
            kind: 'missing_table',
            table: table.name,
            title: `Missing referenced table: ${relation}`,
            message: `Table "${table.name}" references "${relation}", which does not exist`,
          })
        }
      }
      for (const column of missingColumns) {
        issues.push({
          kind: 'missing_column',
          table: table.name,
          column,
          title: `Missing column: ${table.name}.${column}`,
          message: `Column "${column}" of table "${table.name}" is missing after applying the schema`,
        })
      }
      tablesReport.push({ name: table.name, exists, missingColumns, missingRelations })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn({ err: error }, 'Isolated database check could not complete')
    issues.push({ kind: 'schema_error', title: 'Database check could not complete', message })
  } finally {
    if (client) await client.end().catch(() => undefined)
    if (container) {
      try {
        await container.remove({ force: true, v: true })
      } catch {
        // already gone
      }
    }
  }

  const schemaErrors = issues.filter((issue) => issue.kind === 'schema_error')
  const missingTables = issues.filter((issue) => issue.kind === 'missing_table')
  const missingColumns = issues.filter((issue) => issue.kind === 'missing_column')
  const failed = schemaErrors.length > 0 || missingTables.length > 0 || missingColumns.length > 0

  const report = {
    sqlFiles: fileReports,
    tables: tablesReport,
    issues: issues.slice(0, 50),
    summary: {
      filesApplied: fileReports.filter((entry) => entry.ok).length,
      filesFailed: fileReports.filter((entry) => !entry.ok).length,
      tablesExpected: scannedTables.length,
      tablesCreated: tablesReport.filter((entry) => entry.exists).length,
      missingColumns: missingColumns.length,
    },
  }

  const logLines = [
    `${fileReports.filter((entry) => entry.ok).length}/${fileReports.length} schema files applied`,
    `${tablesReport.filter((entry) => entry.exists).length}/${scannedTables.length} expected tables created`,
    ...issues.slice(0, 25).map((issue) => `[${issue.kind}] ${issue.message}`),
  ]

  const message = failed
    ? `Database verification failed: ${[
        schemaErrors.length > 0 ? `${schemaErrors.length} schema error(s)` : null,
        missingTables.length > 0 ? `${missingTables.length} missing table reference(s)` : null,
        missingColumns.length > 0 ? `${missingColumns.length} missing column(s)` : null,
      ]
        .filter(Boolean)
        .join(', ')}`
    : `Schema applied cleanly — ${tablesReport.filter((entry) => entry.exists).length}/${scannedTables.length} tables verified in an isolated database`

  return {
    status: failed ? 'failed' : 'passed',
    message,
    issues,
    reportJson: JSON.stringify(report, null, 2),
    logExcerpt: logLines.join('\n'),
    durationMs: Date.now() - startedAt,
  }
}
