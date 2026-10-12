import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { env, isTest } from './config/env.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { apiRateLimit } from './middleware/rateLimit.js'
import { authRouter } from './routes/auth.routes.js'
import { commitsRouter } from './routes/commits.routes.js'
import { findingsRouter } from './routes/findings.routes.js'
import { healthRouter } from './routes/health.routes.js'
import { projectsRouter } from './routes/projects.routes.js'
import { runsRouter } from './routes/runs.routes.js'
import { logger } from './utils/logger.js'

export const API_PREFIX = '/api/v1'

export function createApp(): express.Express {
  const app = express()

  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
    }),
  )
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  if (!isTest) {
    app.use(pinoHttp({ logger }))
  }

  const api = express.Router()
  api.use(apiRateLimit)

  api.use('/health', healthRouter)
  api.use('/auth', authRouter)
  api.use('/projects', projectsRouter)
  api.use('/projects/:projectId/commits', commitsRouter)
  api.use('/runs', runsRouter)
  api.use('/findings', findingsRouter)

  app.use(API_PREFIX, api)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
