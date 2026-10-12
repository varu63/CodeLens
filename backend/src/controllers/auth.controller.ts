import crypto from 'node:crypto'
import type { CookieOptions, Request, Response } from 'express'
import { googleClient, exchangeGoogleCode, googleEnabled } from '../config/google.js'
import { env, isProduction } from '../config/env.js'
import { findUserById } from '../db/queries/users.queries.js'
import {
  issueTokensForUser,
  loginWithPassword,
  logoutWithRefreshToken,
  registerUser,
  rotateRefreshToken,
  upsertGoogleUser,
} from '../services/auth.service.js'
import { REFRESH_TOKEN_TTL_MS } from '../config/jwt.js'
import { requireUser } from '../middleware/authenticate.js'
import { toApiUser } from '../utils/mappers.js'
import { internal, unauthorized } from '../utils/errors.js'
import { logger } from '../utils/logger.js'

const REFRESH_COOKIE = 'pl_refresh'
const OAUTH_STATE_COOKIE = 'pl_oauth_state'

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction, // HTTPS-only cookies in production
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
    maxAge: REFRESH_TOKEN_TTL_MS,
  }
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions())
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(), maxAge: undefined })
}

function clearOAuthStateCookie(res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' })
}

/* --------------------------------- Google OAuth --------------------------------- */

export function googleStart(_req: Request, res: Response): void {
  if (!googleEnabled) {
    res.status(503).json({
      error: { code: 'OAUTH_UNCONFIGURED', message: 'Google sign-in is not configured on this server' },
    })
    return
  }

  const state = crypto.randomBytes(24).toString('hex')
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60 * 1000,
  })

  const url = googleClient.generateAuthUrl({
    access_type: 'online',
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account',
  })
  res.redirect(url)
}

function redirectWithError(res: Response, code: string): void {
  res.redirect(`${env.FRONTEND_URL}/auth/callback?error=${encodeURIComponent(code)}`)
}

export async function googleCallback(req: Request, res: Response): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined
  const state = typeof req.query.state === 'string' ? req.query.state : undefined
  const oauthError = typeof req.query.error === 'string' ? req.query.error : undefined
  const stateCookie = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined
  clearOAuthStateCookie(res)

  if (oauthError || !code) {
    redirectWithError(res, 'oauth_denied')
    return
  }

  if (!state || !stateCookie || state.length !== stateCookie.length) {
    redirectWithError(res, 'invalid_state')
    return
  }
  const stateMatches = crypto.timingSafeEqual(Buffer.from(state), Buffer.from(stateCookie))
  if (!stateMatches) {
    redirectWithError(res, 'invalid_state')
    return
  }

  try {
    const profile = await exchangeGoogleCode(code)
    const user = await upsertGoogleUser(profile)
    const tokens = await issueTokensForUser(user)
    setRefreshCookie(res, tokens.refreshToken)
    res.redirect(`${env.FRONTEND_URL}/auth/callback`)
  } catch (error) {
    logger.error({ err: error }, 'Google OAuth callback failed')
    redirectWithError(res, 'oauth_failed')
  }
}

/* ------------------------------------ Email/password ------------------------------------ */

export async function register(req: Request, res: Response): Promise<void> {
  const { user, tokens } = await registerUser(req.body as { name: string; email: string; password: string })
  setRefreshCookie(res, tokens.refreshToken)
  res.status(201).json({ accessToken: tokens.accessToken, user: toApiUser(user) })
}

export async function login(req: Request, res: Response): Promise<void> {
  const { user, tokens } = await loginWithPassword(req.body as { email: string; password: string })
  setRefreshCookie(res, tokens.refreshToken)
  res.json({ accessToken: tokens.accessToken, user: toApiUser(user) })
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const rawToken = req.cookies?.[REFRESH_COOKIE] as string | undefined
  if (!rawToken) {
    clearRefreshCookie(res)
    throw unauthorized('Your session has expired — please sign in again')
  }
  try {
    const { user, tokens } = await rotateRefreshToken(rawToken)
    setRefreshCookie(res, tokens.refreshToken)
    res.json({ accessToken: tokens.accessToken, user: toApiUser(user) })
  } catch (error) {
    clearRefreshCookie(res)
    throw error
  }
}

export async function logout(req: Request, res: Response): Promise<void> {
  const rawToken = req.cookies?.[REFRESH_COOKIE] as string | undefined
  await logoutWithRefreshToken(rawToken)
  clearRefreshCookie(res)
  res.status(204).end()
}

export async function me(req: Request, res: Response): Promise<void> {
  const { sub } = requireUser(req)
  const user = await findUserById(sub)
  if (!user) throw internal('Your account no longer exists')
  res.json(toApiUser(user))
}
