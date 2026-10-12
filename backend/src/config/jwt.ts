import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from './env.js'

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

const ISSUER = 'proofloop'

export interface AccessTokenClaims {
  sub: string
  role: 'user' | 'admin'
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign({ role: claims.role }, env.JWT_SECRET, {
    subject: claims.sub,
    issuer: ISSUER,
    expiresIn: '15m',
  })
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  const payload = jwt.verify(token, env.JWT_SECRET, { issuer: ISSUER })
  if (typeof payload === 'string' || typeof payload.sub !== 'string') {
    throw new jwt.JsonWebTokenError('Malformed token payload')
  }
  const role = payload['role'] === 'admin' ? 'admin' : 'user'
  return { sub: payload.sub, role }
}

/**
 * Refresh tokens are JWTs signed with a separate secret so they can carry the
 * rotation family. Only the sha256 hash is ever stored; a stolen database row
 * cannot be replayed.
 */
export function signRefreshToken(payload: { sub: string; familyId: string }): string {
  return jwt.sign(
    { family: payload.familyId, jti: crypto.randomUUID() },
    env.JWT_REFRESH_SECRET,
    { subject: payload.sub, issuer: ISSUER, expiresIn: '7d' },
  )
}

export interface RefreshTokenClaims {
  sub: string
  familyId: string
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, { issuer: ISSUER })
  if (
    typeof payload === 'string' ||
    typeof payload.sub !== 'string' ||
    typeof payload['family'] !== 'string'
  ) {
    throw new jwt.JsonWebTokenError('Malformed refresh token payload')
  }
  return { sub: payload.sub, familyId: payload['family'] }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}
