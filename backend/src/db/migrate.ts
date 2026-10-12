import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closePool, pool } from '../config/db.js'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

async function main(): Promise<void> {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name       TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  )

  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort()
  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((row) => row.name),
  )

  let count = 0
  for (const file of files) {
    if (applied.has(file)) {
      continue
    }
    const sql = await readFile(path.join(migrationsDir, file), 'utf8')
    process.stdout.write(`Applying ${file} … `)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
      process.stdout.write('ok\n')
      count += 1
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined)
      process.stdout.write('FAILED\n')
      throw error
    } finally {
      client.release()
    }
  }

  process.stdout.write(count === 0 ? 'Database is up to date.\n' : `Applied ${count} migration(s).\n`)
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => closePool())
