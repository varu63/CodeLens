import { Router } from 'express'
import {
  googleCallback,
  googleStart,
  login,
  logout,
  me,
  refresh,
  register,
} from '../controllers/auth.controller.js'
import { authenticate } from '../middleware/authenticate.js'
import { authRateLimit } from '../middleware/rateLimit.js'
import { validate } from '../middleware/validate.js'
import { loginSchema, registerSchema } from '../validators/auth.validators.js'
import { asyncHandler } from '../utils/asyncHandler.js'

export const authRouter = Router()

authRouter.get('/google', authRateLimit, googleStart)
authRouter.get('/google/callback', authRateLimit, asyncHandler(googleCallback))
authRouter.post('/register', authRateLimit, validate({ body: registerSchema }), asyncHandler(register))
authRouter.post('/login', authRateLimit, validate({ body: loginSchema }), asyncHandler(login))
authRouter.post('/refresh', authRateLimit, asyncHandler(refresh))
authRouter.post('/logout', asyncHandler(logout))
authRouter.get('/me', authenticate, asyncHandler(me))
