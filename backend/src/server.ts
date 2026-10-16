import { createApp } from './app.js'
import { assertDatabaseReady } from './config/db.js'
import { env } from './config/env.js'
import { ensureBucket } from './config/storage.js'
import { startRunWorker, stopRunWorker } from './queue/run.worker.js'
import { logger } from './utils/logger.js'

async function main(): Promise<void> {
  // Fail fast: never start a server whose database is unreachable or unmigrated.
  await assertDatabaseReady()

  try {
    await ensureBucket()
  } catch (error) {
    logger.warn({ err: error }, 'Artifact storage bucket is not reachable yet — will retry on use')
  }

  const app = createApp()

  const server = app.listen(env.PORT, () => {
    logger.info(`ProofLoop API listening on http://localhost:${env.PORT}/api/v1`)
  })

  // In-process worker keeps `npm run dev` self-contained; `npm run worker`
  // runs it standalone when you want to scale the API and workers separately.
  startRunWorker()

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down')
    server.close()
    void stopRunWorker().finally(() => process.exit(0))
    setTimeout(() => process.exit(1), 5000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  logger.fatal(error, 'Server failed to start')
  process.exit(1)
})
