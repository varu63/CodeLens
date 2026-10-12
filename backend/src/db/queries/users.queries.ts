import { query } from '../../config/db.js'

export interface UserRow {
  id: string
  name: string
  email: string
  google_id: string | null
  avatar_url: string | null
  password_hash: string | null
  role: 'user' | 'admin'
  created_at: Date
  updated_at: Date
}

const COLUMNS = `id, name, email, google_id, avatar_url, password_hash, role, created_at, updated_at`

export async function findUserById(id: string): Promise<UserRow | null> {
  const result = await query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id])
  return result.rows[0] ?? null
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE lower(email) = lower($1)`, [email])
  return result.rows[0] ?? null
}

export async function findUserByGoogleId(googleId: string): Promise<UserRow | null> {
  const result = await query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE google_id = $1`, [googleId])
  return result.rows[0] ?? null
}

export async function createUser(input: {
  name: string
  email: string
  googleId?: string | null
  avatarUrl?: string | null
  passwordHash?: string | null
  role?: 'user' | 'admin'
}): Promise<UserRow> {
  const result = await query<UserRow>(
    `INSERT INTO users (name, email, google_id, avatar_url, password_hash, role)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [
      input.name,
      input.email,
      input.googleId ?? null,
      input.avatarUrl ?? null,
      input.passwordHash ?? null,
      input.role ?? 'user',
    ],
  )
  const row = result.rows[0]
  if (!row) throw new Error('INSERT INTO users returned no row')
  return row
}

export async function updateUserProfile(
  id: string,
  changes: { name?: string; avatarUrl?: string | null; googleId?: string },
): Promise<UserRow> {
  const result = await query<UserRow>(
    `UPDATE users
       SET name       = COALESCE($2, name),
           avatar_url = COALESCE($3, avatar_url),
           google_id  = COALESCE($4, google_id),
           updated_at = now()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, changes.name ?? null, changes.avatarUrl ?? null, changes.googleId ?? null],
  )
  const row = result.rows[0]
  if (!row) throw new Error(`User ${id} disappeared during update`)
  return row
}
