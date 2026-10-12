import type { NextFunction, Request, Response } from 'express'
import { unauthorized } from '../utils/errors.js'
import { verifyAccessToken } from '../config/jwt.js'
import type { AccessTokenClaims } from '../config/jwt.js'

/**
 * Verifies the Bearer access token. Tokens only ever travel in the
 * Authorization header — never in URLs or cookies.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined
  if (!token) {
    next(unauthorized())
    return
  }
  try {
    req.user = verifyAccessToken(token)
    next()
  } catch {
    next(unauthorized('Invalid or expired token'))
  }
}

/** For controllers mounted behind `authenticate`. */
export function requireUser(req: Request): AccessTokenClaims {
  if (!req.user) throw unauthorized()
  return req.user
}
