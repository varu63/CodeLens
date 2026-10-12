import { pathToFileURL } from 'node:url'
import { Worker } from 'bullmq'
import { createRedisConnection } from '../config/redis.js'
import { executeRun } from '../services/run.pipeline.js'
import { logger } from '../utils/logger.js'
import { RUN_QUEUE_NAME } from './queues.js'
import type { RunJobData } from './queues.js'

let worker: Worker<RunJobData> | null = null

/**
 * Consumes verification-run jobs. Started both by the API server (so a plain
 * `npm run dev` works end to end) and by `npm run worker` when you want the
 * worker as its own process.
 */
export function startRunWorker(): Worker<RunJobData> {
  if (worker) return worker

  worker = new Worker<RunJobData>(
    RUN_QUEUE_NAME,
    async (job) => {
      logger.info({ runId: job.data.runId, projectId: job.data.projectId }, 'Run picked up')
      await executeRun(job.data.runId, job.data.projectId)
    },
    {
      connection: createRedisConnection(),
      concurrency: 1,
    },
  )

  worker.on('failed', (job, error) => {
    logger.error({ err: error, runId: job?.data.runId }, 'Run job failed')
  })
  worker.on('error', (error) => {
    logger.error({ err: error }, 'Run worker error')
  })

  return worker
}

export async function stopRunWorker(): Promise<void> {
  if (!worker) return
  await worker.close()
  worker = null
}

const launchedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (launchedDirectly) {
  startRunWorker()
  logger.info('ProofLoop standalone run worker started')

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down run worker')
    void stopRunWorker().finally(() => process.exit(0))
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}
