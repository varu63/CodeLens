import { Queue } from 'bullmq'
import { createRedisConnection } from '../config/redis.js'

export const RUN_QUEUE_NAME = 'proofloop-runs'

export interface RunJobData {
  runId: string
  projectId: string
}

let queue: Queue<RunJobData> | null = null

export function getRunQueue(): Queue<RunJobData> {
  queue ??= new Queue<RunJobData>(RUN_QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  })
  return queue
}

/** Enqueues a verification run; jobId = runId keeps this idempotent. */
export async function enqueueRun(runId: string, projectId: string): Promise<void> {
  await getRunQueue().add('verify', { runId, projectId }, { jobId: runId })
}

/** Removes a still-waiting job (used when a queued run is cancelled). */
export async function removeQueuedRun(runId: string): Promise<void> {
  try {
    const job = await getRunQueue().getJob(runId)
    if (job) await job.remove()
  } catch {
    // job may already be active or gone — cancelling is best-effort
  }
}
