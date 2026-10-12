/*
 * Dev seed: upserts the demo account used by the frontend login screen.
 * Run with `npm run seed` (requires the compose stack + `npm run migrate`).
 */
import bcrypt from 'bcryptjs'
import { closePool, query } from '../src/config/db.js'

const SEED_EMAIL = process.env.SEED_EMAIL ?? 'varun@acme.dev'
const SEED_NAME = process.env.SEED_NAME ?? 'Varun (demo)'
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'password123'

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10)
  const result = await query<{ id: string; email: string; role: string }>(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, 'admin')
     ON CONFLICT (lower(email)) DO UPDATE
        SET name = EXCLUDED.name,
            password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role,
            updated_at = now()
     RETURNING id, email, role`,
    [SEED_NAME, SEED_EMAIL, passwordHash],
  )
  const row = result.rows[0]
  if (!row) throw new Error('seed upsert returned no row')
  // eslint-disable-next-line no-console
  console.log(`Seeded ${row.email} (${row.role}) — id ${row.id}. Sign in with the SEED_PASSWORD value.`)
}

main()
  .catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => closePool())
