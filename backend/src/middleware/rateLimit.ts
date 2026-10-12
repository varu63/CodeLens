import rateLimit from 'express-rate-limit'
import { isTest } from '../config/env.js'

const RATE_LIMITED_BODY = { error: { code: 'RATE_LIMITED', message: 'Too many requests' } }

/** Strict limiter for auth endpoints (login, register, refresh, oauth start). */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
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
