import rateLimit from 'express-rate-limit'
import { isProduction, isTest } from '../config/env.js'

const RATE_LIMITED_BODY = { error: { code: 'RATE_LIMITED', message: 'Too many requests' } }

/**
 * Strict limiter for credential endpoints (login/register, OAuth start).
 * Refresh is intentionally NOT here — a stale-session client must never be able
 * to lock the user out of logging in. Outside production the cap is high enough
 * that normal dev/hot-reload traffic never trips it.
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isProduction ? 40 : 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: RATE_LIMITED_BODY,
})

/** General API limiter. */
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  message: RATE_LIMITED_BODY,
})
