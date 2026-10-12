import { Redis } from 'ioredis'
import { env } from './env.js'

/**
 * BullMQ requires dedicated connections with `maxRetriesPerRequest: null`.
 * Queue producers and workers each get their own.
 */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  })
}

export async function redisPing(): Promise<boolean> {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    lazyConnect: true,
  })
  try {
    await client.connect()
    const pong = await client.ping()
    return pong === 'PONG'
  } catch {
    return false
  } finally {
    client.disconnect()
  }
}
