import pg from 'pg'
import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import { env } from './env.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
})

pool.on('error', (error) => {
  // Idle client errors must not crash the process.
  // eslint-disable-next-line no-console
  console.error('Unexpected error on idle postgres client', error)
})

export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params)
}

/** Runs `fn` inside a transaction; rolls back on any throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function dbPing(): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}

/**
 * Startup gate: prove the database is reachable AND migrated before the server
 * accepts traffic. Throws with an actionable message instead of booting broken.
 */
export async function assertDatabaseReady(): Promise<void> {
  try {
    await pool.query('SELECT 1')
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : String(error)
    throw new Error(`Database connection failed: check DATABASE_URL (${reason})`)
  }

  const { rows } = await pool.query<{ regclass: string | null }>(
    `SELECT to_regclass('public.users') AS regclass`,
  )
  if (!rows[0]?.regclass) {
    throw new Error('Tables missing: run npm run migrate')
  }
}

export async function closePool(): Promise<void> {
  await pool.end()
}
