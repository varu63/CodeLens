import type { RequestHandler } from 'express'
import type { ZodTypeAny } from 'zod'

export interface ValidationSchemas {
  body?: ZodTypeAny
  query?: ZodTypeAny
  params?: ZodTypeAny
}

/** Parses and replaces request parts with zod-validated, coerced values. */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body)
      }
      if (schemas.query) {
        ;(req as { query: unknown }).query = schemas.query.parse(req.query)
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params
      }
      next()
    } catch (error) {
      next(error)
    }
  }
}
