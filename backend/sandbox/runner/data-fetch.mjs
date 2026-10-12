/**
 * ProofLoop data-fetch runner.
 *
 * Boots the project under test and requests every frontend API call the
 * structure scan found, recording the raw HTTP outcome per call.
 * The worker maps these observations onto the structure map (ok / broken).
 *
 * Reads  /proofloop/plan.json          (written by the worker)
 * Writes /proofloop/out/data-fetch-results.json
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const PLAN_PATH = '/proofloop/plan.json'
const OUT_DIR = '/proofloop/out'
const OUT_PATH = `${OUT_DIR}/data-fetch-results.json`

const REQUEST_TIMEOUT_MS = 10_000
const SERVER_POLL_INTERVAL_MS = 500

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

async function attemptToken(baseUrl) {
  if (!plan.auth) return null
  const credentials = {
    name: 'ProofLoop Agent',
    email: `proofloop+fetch+${Date.now()}@example.com`,
    password: 'Proofloop!2345',
  }
  const attempts = []
  if (plan.auth.register) {
    attempts.push({ label: 'register', endpoint: plan.auth.register, body: { ...credentials, ...(plan.auth.register.body ?? {}) } })
  }
  if (plan.auth.login) {
    attempts.push({ label: 'login', endpoint: plan.auth.login, body: { email: credentials.email, password: credentials.password } })
  }
  for (const attempt of attempts) {
    try {
      const response = await timedFetch(`${baseUrl}${attempt.endpoint.path}`, {
        method: attempt.endpoint.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt.body),
      })
      const text = await response.text()
      let parsed = null
      try { parsed = JSON.parse(text) } catch { /* non-JSON */ }
      const token = parsed?.accessToken ?? parsed?.token ?? parsed?.data?.accessToken ?? null
      if (response.status < 300 && token) return token
    } catch {
      // try the next candidate
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

  const needsAnyToken = plan.calls.some((call) => call.needsAuth)
  const token = needsAnyToken ? await attemptToken(baseUrl) : null

  for (const call of plan.calls) {
    const url = `${baseUrl}${normalizePath(call.path)}`
    const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(call.method)
    const headers = { 'Content-Type': 'application/json' }
    if (call.needsAuth && token) headers.Authorization = `Bearer ${token}`
    try {
      const response = await timedFetch(url, {
        method: call.method,
        headers,
        body: write ? JSON.stringify(call.sampleBody ?? {}) : undefined,
      })
      const bodyText = (await response.text().catch(() => '')).slice(0, 400)
      results.push({
        method: call.method,
        path: call.path,
        needsAuth: Boolean(call.needsAuth),
        httpStatus: response.status,
        responseExcerpt: bodyText,
      })
    } catch (error) {
      results.push({
        method: call.method,
        path: call.path,
        needsAuth: Boolean(call.needsAuth),
        httpStatus: null,
        error: error.name === 'AbortError' ? 'request timed out' : String(error.message ?? error),
      })
    }
  }

  writeFileSync(OUT_PATH, JSON.stringify({
    serverStarted: true,
    authTokenObtained: needsAnyToken ? Boolean(token) : true,
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
