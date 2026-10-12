import type { Request, Response } from 'express'
import { dbPing } from '../config/db.js'

export async function healthCheck(_req: Request, res: Response): Promise<void> {
  const dbUp = await dbPing()
  res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'error', db: dbUp ? 'up' : 'down' })
}
