import type { Request, Response } from 'express'
import { pool } from '../config/db.js'
import { isProduction } from '../config/env.js'

export async function healthCheck(_req: Request, res: Response): Promise<void> {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', db: 'up' })
  } catch (error) {
    const reason =
      error instanceof Error && error.message ? error.message : String(error)
    res.status(503).json({
      status: 'error',
      db: 'down',
      message: isProduction ? 'Database unavailable' : `Database check failed: ${reason}`,
    })
  }
}
