import type { NextFunction, Request, Response } from 'express'
import { forbidden, unauthorized } from '../utils/errors.js'

/** Gate a route to specific roles, e.g. authorize('admin'). */
export function authorize(...roles: Array<'user' | 'admin'>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(unauthorized())
      return
    }
    if (!roles.includes(req.user.role)) {
      next(forbidden('This area requires a higher role'))
      return
    }
    next()
  }
}
