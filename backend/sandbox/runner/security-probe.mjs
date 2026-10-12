/**
 * ProofLoop security probe.
 *
 * Boots the project under test and requests every scanned route WITHOUT an
 * Authorization header, recording whether the route denies the request.
 * Routes the scan marked as protected but which answer anyway are the
 * "unprotected route" findings; unclear ones come back as evidence.
 *
 * Reads  /proofloop/plan.json            (written by the worker)
 * Writes /proofloop/out/security-probe.json
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const PLAN_PATH = '/proofloop/plan.json'
const OUT_DIR = '/proofloop/out'
const OUT_PATH = `${OUT_DIR}/security-probe.json`

const REQUEST_TIMEOUT_MS = 10_000
const SERVER_POLL_INTERVAL_MS = 500
const EXCERPT_LIMIT = 400

const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'))
const results = []
const startLog = []

function normalizePath(routePath) {
  return routePath.replace(/:[A-Za-z_][\w]*/g, randomUUID())
}

async function timedFetch(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function waitForServer(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await timedFetch(`${baseUrl}/`, { method: 'GET' }, 3_000)
      return response.status
    } catch {
      await new Promise((resolve) => setTimeout(resolve, SERVER_POLL_INTERVAL_MS))
    }
  }
  return null
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true })

  const baseUrl = `http://127.0.0.1:${plan.port}`
  const child = spawn('sh', ['-c', plan.startCommand], {
    cwd: '/workspace',
    env: { ...process.env, PORT: String(plan.port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const collect = (chunk) => {
    startLog.push(chunk.toString('utf8'))
    if (startLog.length > 400) startLog.shift()
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  const startupStatus = await waitForServer(baseUrl, plan.startTimeoutMs ?? 20_000)
  if (startupStatus === null) {
    writeFileSync(OUT_PATH, JSON.stringify({
      serverStarted: false,
      startLogTail: startLog.join('').slice(-8000),
      results: [],
    }, null, 2))
    child.kill('SIGKILL')
    return
  }

  for (const route of plan.routes) {
    const url = `${baseUrl}${normalizePath(route.path)}`
    const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method)
    try {
      const response = await timedFetch(url, {
        method: route.method,
        headers: { 'Content-Type': 'application/json' },
        body: write ? JSON.stringify(route.sampleBody ?? {}) : undefined,
      })
      const bodyText = (await response.text().catch(() => '')).slice(0, EXCERPT_LIMIT)
      results.push({
        method: route.method,
        path: route.path,
        auth: route.auth,
        httpStatus: response.status,
        denied: response.status === 401 || response.status === 403,
        responseExcerpt: bodyText,
      })
    } catch (error) {
      results.push({
        method: route.method,
        path: route.path,
        auth: route.auth,
        httpStatus: null,
        denied: false,
        error: error.name === 'AbortError' ? 'request timed out' : String(error.message ?? error),
      })
    }
  }

  writeFileSync(OUT_PATH, JSON.stringify({
    serverStarted: true,
    startLogTail: startLog.join('').slice(-8000),
    results,
  }, null, 2))

  child.kill('SIGKILL')
}

run()
  .catch((error) => {
    try {
      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(OUT_PATH, JSON.stringify({
        serverStarted: false,
        startLogTail: String(error?.stack ?? error),
        results: [],
      }, null, 2))
    } catch {
      // nothing more we can do
    }
  })
  .finally(() => {
    setTimeout(() => process.exit(0), 300).unref()
  })
