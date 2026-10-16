import type { NextFunction, Request, Response } from 'express'
import { MulterError } from 'multer'
import pg from 'pg'
import { ZodError } from 'zod'
import { isProduction } from '../config/env.js'
import { AppError } from '../utils/errors.js'
import { logger } from '../utils/logger.js'

const { DatabaseError } = pg

/** SQLSTATE / system codes that mean "the database itself is unreachable or unready". */
const DB_FAILURE_CODES = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  '28P01', // invalid_password
  '3D000', // invalid_catalog_name (database does not exist)
  '42P01', // undefined_table (migrations not run)
])

function isDatabaseFailure(error: unknown): boolean {
  if (error instanceof DatabaseError) return DB_FAILURE_CODES.has(error.code ?? '')
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    DB_FAILURE_CODES.has(String((error as { code: unknown }).code))
  )
}

export interface ErrorBody {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  const body: ErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found' } }
  res.status(404).json(body)
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ZodError) {
    const issues = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }))
    const body: ErrorBody = {
      error: {
        code: 'VALIDATION',
        message: issues[0]?.message ?? 'The request was invalid',
        details: issues,
      },
    }
    res.status(400).json(body)
    return
  }

  if (error instanceof MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    const body: ErrorBody = {
      error: {
        code: error.code,
        message: error.code === 'LIMIT_FILE_SIZE' ? 'The upload is too large' : error.message,
      },
    }
    res.status(status).json(body)
    return
  }

  if (error instanceof AppError) {
    const body: ErrorBody = { error: { code: error.code, message: error.message } }
    if (error.details !== undefined) body.error.details = error.details
    res.status(error.status).json(body)
    return
  }

  if (isDatabaseFailure(error)) {
    // Broken credentials, unreachable host or missing migrations — never leak
    // connection details; the real error stays in the logs (and the response in dev).
    logger.error({ err: error, url: req.originalUrl, method: req.method }, 'Database error')
    const message = isProduction ? 'Service temporarily unavailable' : `Service temporarily unavailable: ${String(error)}`
    const body: ErrorBody = { error: { code: 'SERVICE_UNAVAILABLE', message } }
    res.status(503).json(body)
    return
  }

  logger.error({ err: error, url: req.originalUrl, method: req.method }, 'Unhandled error')
  const body: ErrorBody = {
    error: {
      code: 'INTERNAL',
      message: isProduction ? 'Internal server error' : `Internal server error: ${String(error)}`,
    },
  }
  res.status(500).json(body)
}
