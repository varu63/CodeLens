export class AppError extends Error {
  readonly status: number
  readonly code: string
  readonly details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message = 'Bad request', code = 'BAD_REQUEST'): AppError =>
  new AppError(400, code, message)

export const unauthorized = (message = 'Authentication required'): AppError =>
  new AppError(401, 'UNAUTHORIZED', message)

export const forbidden = (message = 'You do not have permission to do that'): AppError =>
  new AppError(403, 'FORBIDDEN', message)

/** Also used for IDOR: a resource owned by someone else must look like it does not exist. */
export const notFound = (message = 'Not found'): AppError =>
  new AppError(404, 'NOT_FOUND', message)

export const conflict = (message = 'Conflicts with existing data'): AppError =>
  new AppError(409, 'CONFLICT', message)

export const payloadTooLarge = (message = 'Payload too large'): AppError =>
  new AppError(413, 'PAYLOAD_TOO_LARGE', message)

export const tooManyRequests = (message = 'Too many requests'): AppError =>
  new AppError(429, 'RATE_LIMITED', message)

export const internal = (message = 'Internal server error'): AppError =>
  new AppError(500, 'INTERNAL', message)
