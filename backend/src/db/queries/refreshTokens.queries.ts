import { query } from '../../config/db.js'

export interface RefreshTokenRow {
  id: string
  user_id: string
  token_hash: string
  family_id: string
  expires_at: Date
  revoked_at: Date | null
  created_at: Date
}

export async function insertRefreshToken(input: {
  userId: string
  tokenHash: string
  familyId: string
  expiresAt: Date
}): Promise<RefreshTokenRow> {
  const result = await query<RefreshTokenRow>(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, token_hash, family_id, expires_at, revoked_at, created_at`,
    [input.userId, input.tokenHash, input.familyId, input.expiresAt],
  )
  const row = result.rows[0]
  if (!row) throw new Error('INSERT INTO refresh_tokens returned no row')
  return row
}

export async function findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
  const result = await query<RefreshTokenRow>(
    `SELECT id, user_id, token_hash, family_id, expires_at, revoked_at, created_at
       FROM refresh_tokens
      WHERE token_hash = $1`,
    [tokenHash],
  )
  return result.rows[0] ?? null
}

export async function revokeRefreshToken(id: string): Promise<void> {
  await query(`UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1`, [id])
}

export async function revokeFamily(familyId: string): Promise<number> {
  const result = await query(
    `UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, now())
      WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId],
  )
  return result.rowCount ?? 0
}
