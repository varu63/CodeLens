import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import {
  REFRESH_TOKEN_TTL_MS,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../config/jwt.js'
import type { RefreshTokenClaims } from '../config/jwt.js'
import {
  findRefreshTokenByHash,
  insertRefreshToken,
  revokeFamily,
  revokeRefreshToken,
} from '../db/queries/refreshTokens.queries.js'
import {
  createUser,
  findUserByEmail,
  findUserByGoogleId,
  findUserById,
  updateUserProfile,
} from '../db/queries/users.queries.js'
import type { UserRow } from '../db/queries/users.queries.js'
import type { GoogleProfile } from '../config/google.js'
import { conflict, unauthorized } from '../utils/errors.js'
import { logger } from '../utils/logger.js'

const BCRYPT_ROUNDS = 10

// Compared against when the account does not exist, keeping response timing flat.
const DUMMY_HASH = bcrypt.hashSync('proof-loop-dummy-password', BCRYPT_ROUNDS)

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

async function createTokenPair(user: UserRow, familyId?: string): Promise<TokenPair> {
  const family = familyId ?? crypto.randomUUID()
  const refreshToken = signRefreshToken({ sub: user.id, familyId: family })
  await insertRefreshToken({
    userId: user.id,
    tokenHash: hashToken(refreshToken),
    familyId: family,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  })
  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
    refreshToken,
  }
}

export async function registerUser(input: {
  name: string
  email: string
  password: string
}): Promise<{ user: UserRow; tokens: TokenPair }> {
  const existing = await findUserByEmail(input.email)
  if (existing) throw conflict('An account with this email already exists')

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)
  const user = await createUser({ name: input.name, email: input.email, passwordHash })
  const tokens = await createTokenPair(user)
  return { user, tokens }
}

export async function loginWithPassword(input: {
  email: string
  password: string
}): Promise<{ user: UserRow; tokens: TokenPair }> {
  const user = await findUserByEmail(input.email)
  const hash = user?.password_hash ?? DUMMY_HASH
  const valid = await bcrypt.compare(input.password, hash)
  if (!user || !user.password_hash || !valid) {
    throw unauthorized('Invalid email or password')
  }
  const tokens = await createTokenPair(user)
  return { user, tokens }
}

/**
 * Validates the refresh cookie, ROTATES the token (old one is revoked, a new
 * one is issued within the same family) and returns fresh credentials.
 * Replaying an already-revoked token is treated as theft: the whole family is
 * revoked.
 */
export async function rotateRefreshToken(
  rawToken: string,
): Promise<{ user: UserRow; tokens: TokenPair }> {
  let claims: RefreshTokenClaims
  try {
    claims = verifyRefreshToken(rawToken)
  } catch {
    throw unauthorized('Your session has expired — please sign in again')
  }

  const row = await findRefreshTokenByHash(hashToken(rawToken))
  if (!row) {
    // Signature is valid but the row is gone (e.g. wiped tokens): treat as expired.
    throw unauthorized('Your session has expired — please sign in again')
  }

  if (row.revoked_at) {
    const revoked = await revokeFamily(row.family_id)
    logger.warn(
      { userId: row.user_id, familyId: row.family_id, revokedSiblings: revoked },
      'Refresh token reuse detected — family revoked',
    )
    throw unauthorized('Your session was revoked for security — please sign in again')
  }

  if (row.expires_at.getTime() <= Date.now()) {
    await revokeRefreshToken(row.id)
    throw unauthorized('Your session has expired — please sign in again')
  }

  if (claims.sub !== row.user_id) {
    // Token/row mismatch can only mean tampering.
    await revokeFamily(row.family_id)
    throw unauthorized('Invalid refresh token')
  }

  const user = await findUserById(row.user_id)
  if (!user) throw unauthorized('Your session has expired — please sign in again')

  await revokeRefreshToken(row.id)
  const tokens = await createTokenPair(user, row.family_id)
  return { user, tokens }
}

export async function logoutWithRefreshToken(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return
  try {
    const claims = verifyRefreshToken(rawToken)
    const row = await findRefreshTokenByHash(hashToken(rawToken))
    if (row && !row.revoked_at && claims.sub === row.user_id) {
      await revokeRefreshToken(row.id)
    }
  } catch {
    // Invalid/expired token: nothing to revoke, the cookie is cleared anyway.
  }
}

/** Find-or-create the user behind a Google profile. */
export async function upsertGoogleUser(profile: GoogleProfile): Promise<UserRow> {
  const byGoogleId = await findUserByGoogleId(profile.googleId)
  if (byGoogleId) {
    const changed =
      byGoogleId.name !== profile.name ||
      (profile.avatarUrl && byGoogleId.avatar_url !== profile.avatarUrl)
    return changed
      ? updateUserProfile(byGoogleId.id, { name: profile.name, avatarUrl: profile.avatarUrl ?? null })
      : byGoogleId
  }

  const byEmail = await findUserByEmail(profile.email)
  if (byEmail) {
    return updateUserProfile(byEmail.id, {
      googleId: profile.googleId,
      avatarUrl: profile.avatarUrl ?? null,
    })
  }

  return createUser({
    name: profile.name,
    email: profile.email,
    googleId: profile.googleId,
    avatarUrl: profile.avatarUrl ?? null,
  })
}

export async function issueTokensForUser(user: UserRow): Promise<TokenPair> {
  return createTokenPair(user)
}
