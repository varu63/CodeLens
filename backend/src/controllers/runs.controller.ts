import type { Request, Response } from 'express'
import { requireUser } from '../middleware/authenticate.js'
import {
  cancelRunForUser,
  getArtifactForUser,
  getLoadTestForUser,
  getRunForUser,
  getRunRowForUser,
  listChecksForUser,
  listRunsForUser,
  openRunStream,
  rerunForUser,
  sendRunToAgentForUser,
  startRunForProject,
} from '../services/runs.service.js'
import { buildRunReportForUser } from '../services/report.service.js'
import { listRunFindingsForUser } from '../services/findings.service.js'
import type { ListFindingsQuery } from '../validators/findings.validators.js'
import type {
  ListChecksQuery,
  ListRunsQuery,
  ReportQuery,
  SendToAgentInput,
  StartRunInput,
} from '../validators/runs.validators.js'

/** POST /projects/:id/runs → 202 { runId, status: "queued" } */
export async function startProjectRun(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const body = req.body as StartRunInput
  const { run } = await startRunForProject(user.sub, req.params.id ?? '', {
    ...(body.loadUsers !== undefined ? { loadUsers: body.loadUsers } : {}),
    ...(body.checks !== undefined ? { checks: body.checks } : {}),
    ...(body.commit !== undefined ? { commit: body.commit } : {}),
  })
  res.status(202).json({ runId: run.id, status: run.status })
}

/** GET /projects/:id/runs */
export async function listProjectRuns(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const query = req.query as unknown as ListRunsQuery
  const result = await listRunsForUser(user.sub, req.params.id ?? '', {
    page: query.page,
    limit: query.limit,
    ...(query.status ? { status: query.status } : {}),
  })
  res.json({
    items: result.items,
    page: query.page,
    limit: query.limit,
    total: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / query.limit)),
  })
}

export async function getRun(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  res.json(await getRunForUser(user.sub, req.params.runId ?? ''))
}

/** GET /runs/:runId/checks */
export async function listRunChecks(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const query = req.query as unknown as ListChecksQuery
  const result = await listChecksForUser(user.sub, req.params.runId ?? '', {
    page: query.page,
    limit: query.limit,
    ...(query.type ? { type: query.type } : {}),
  })
  res.json({
    items: result.items,
    page: query.page,
    limit: query.limit,
    total: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / query.limit)),
  })
}

export async function cancelRun(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  res.json(await cancelRunForUser(user.sub, req.params.runId ?? ''))
}

/** GET /runs/:runId/load-test */
export async function getRunLoadTest(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  res.json(await getLoadTestForUser(user.sub, req.params.runId ?? ''))
}

/** GET /runs/:runId/findings */
export async function listRunFindings(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const query = req.query as unknown as ListFindingsQuery
  const result = await listRunFindingsForUser(user.sub, req.params.runId ?? '', query)
  res.json({
    items: result.items,
    page: query.page,
    limit: query.limit,
    total: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / query.limit)),
  })
}

/** POST /runs/:runId/rerun → 202 { runId, previousRunId } */
export async function rerunRun(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const body = req.body as StartRunInput
  const result = await rerunForUser(user.sub, req.params.runId ?? '', {
    ...(body.loadUsers !== undefined ? { loadUsers: body.loadUsers } : {}),
  })
  res.status(202).json({ runId: result.run.id, previousRunId: result.previousRunId })
}

export async function getRunArtifact(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const result = await getArtifactForUser(user.sub, req.params.runId ?? '', req.params.artifactId ?? '')
  res.json(result)
}

/**
 * GET /runs/:runId/stream — Server-sent events.
 * Auth travels in the Authorization header, never the URL.
 */
export async function streamRun(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const runId = req.params.runId ?? ''

  // Ownership before any bytes are flushed so 404s stay JSON.
  const run = await getRunRowForUser(user.sub, runId)

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const handle = await openRunStream(
    run,
    (chunk) => {
      if (!res.writableEnded) res.write(chunk)
    },
    () => {
      if (!res.writableEnded) res.end()
    },
  )

  if (!res.writableEnded) {
    req.on('close', () => handle.close())
  } else {
    handle.close()
  }
}

/** GET /runs/:runId/report?format=json|pdf */
export async function getRunReport(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const query = req.query as unknown as ReportQuery
  const result = await buildRunReportForUser(user.sub, req.params.runId ?? '', query.format)
  if (result.kind === 'json') {
    res.json(result.report)
    return
  }
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
  res.send(result.buffer)
}

/** POST /runs/:runId/send-to-agent → 202 { agentRunId, agentJobId, ... } */
export async function sendRunToAgent(req: Request, res: Response): Promise<void> {
  const user = requireUser(req)
  const body = req.body as SendToAgentInput
  const result = await sendRunToAgentForUser(user.sub, req.params.runId ?? '', {
    agent: body.agent,
    findingIds: body.findingIds,
  })
  res.status(202).json(result)
}
