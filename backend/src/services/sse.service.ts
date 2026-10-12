import type { RunStreamEvent } from '../types/stream.types.js'
import { logger } from '../utils/logger.js'

type Listener = (event: RunStreamEvent) => void

/**
 * In-process fan-out for run progress. The worker publishes; every open
 * SSE response for that run receives the event. Single-instance design —
 * with multiple API instances this would move to Redis pub/sub.
 */
class RunEventBus {
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly finished = new Set<string>()

  subscribe(runId: string, listener: Listener): () => void {
    const set = this.listeners.get(runId) ?? new Set<Listener>()
    set.add(listener)
    this.listeners.set(runId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(runId)
    }
  }

  publish(runId: string, event: RunStreamEvent): void {
    if (event.type === 'done') this.finished.add(runId)
    const set = this.listeners.get(runId)
    if (!set) return
    for (const listener of set) {
      try {
        listener(event)
      } catch (error) {
        logger.warn({ err: error, runId }, 'SSE listener threw')
      }
    }
  }

  /** True once a terminal event has been published for this run. */
  isFinished(runId: string): boolean {
    return this.finished.has(runId)
  }
}

export const runEvents = new RunEventBus()
