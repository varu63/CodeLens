import type { AccessTokenClaims } from '../config/jwt.js'

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware from the verified access JWT. */
      user?: AccessTokenClaims
    }
  }
}

export {}
