/**
 * ProofLoop load-test runner.
 *
 * Boots the project under test and ramps autocannon across the configured
 * connection levels (1 → 10 → 50 → user-max) for each GET route in the plan.
 * Raw numbers only — threshold judgements happen in the worker.
 *
 * Reads  /proofloop/plan.json          (written by the worker)
 * Writes /proofloop/out/load-results.json
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const PLAN_PATH = '/proofloop/plan.json'
const OUT_DIR = '/proofloop/out'
const OUT_PATH = `${OUT_DIR}/load-results.json`

const SERVER_POLL_INTERVAL_MS = 500
const AUTOCANNON_TIMEOUT_MS = 90_000

const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'))
const startLog = []

function logLine(line) {
  startLog.push(line)
  if (startLog.length > 400) startLog.shift()
}

async function timedFetch(url, options = {}, timeoutMs = 10_000) {
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
    email: `proofloop+load+${Date.now()}@example.com`,
    password: 'Proofloop!2345',
  }
  const attempts = []
  if (plan.auth.register) {
    attempts.push({ endpoint: plan.auth.register, body: { ...credentials, ...(plan.auth.register.body ?? {}) } })
  }
  if (plan.auth.login) {
    attempts.push({ endpoint: plan.auth.login, body: { email: credentials.email, password: credentials.password } })
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

/** autocannon's histogram has no exact p95; interpolate between p90 and p97.5. */
function interpolateP95(latency) {
  const p90 = latency.p90
  const p97_5 = latency.p97_5
  if (typeof p90 === 'number' && typeof p97_5 === 'number') {
    return Math.round((p90 + (p97_5 - p90) * (5 / 7.5)) * 100) / 100
  }
  return latency.p97_5 ?? latency.average ?? 0
}

function runAutocannon(url, users, durationSec, token) {
  const args = ['-j', '-c', String(users), '-d', String(durationSec), '-m', 'GET']
  if (token) args.push('-H', `authorization=Bearer ${token}`)
  args.push(url)

  const outcome = spawnSync('autocannon', args, {
    timeout: AUTOCANNON_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (outcome.error) throw outcome.error
  const stdout = outcome.stdout?.toString('utf8') ?? ''
  const jsonStart = stdout.indexOf('{')
  if (jsonStart === -1) {
    throw new Error(`autocannon produced no JSON (exit ${outcome.status}): ${stdout.slice(0, 400)}`)
  }
  return JSON.parse(stdout.slice(jsonStart))
}

function summarize(users, json) {
  const total = json.requests?.total ?? 0
  const bad = (json.non2xx ?? 0) + (json.errors ?? 0) + (json.timeouts ?? 0)
  const errorRatePct = total > 0 ? Math.round((bad / total) * 10_000) / 100 : 100
  return {
    users,
    avgMs: json.latency?.average ?? null,
    p50Ms: json.latency?.p50 ?? null,
    p95Ms: json.latency ? interpolateP95(json.latency) : null,
    p99Ms: json.latency?.p99 ?? null,
    errorRatePct,
    requestsPerSecond: json.requests?.average ?? 0,
    non2xx: json.non2xx ?? 0,
    errors: json.errors ?? 0,
    timeouts: json.timeouts ?? 0,
    totalRequests: total,
  }
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true })

  const autocannonCheck = spawnSync('autocannon', ['--version'], { timeout: 10_000 })
  const autocannonAvailable = !autocannonCheck.error && autocannonCheck.status === 0
  if (!autocannonAvailable) {
    writeFileSync(OUT_PATH, JSON.stringify({
      serverStarted: false,
      autocannonAvailable: false,
      startLogTail: 'autocannon binary not found in the sandbox image',
      results: [],
    }, null, 2))
    return
  }

  const baseUrl = `http://127.0.0.1:${plan.port}`
  const child = spawn('sh', ['-c', plan.startCommand], {
    cwd: '/workspace',
    env: { ...process.env, PORT: String(plan.port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => logLine(chunk.toString('utf8')))
  child.stderr.on('data', (chunk) => logLine(chunk.toString('utf8')))

  const startupStatus = await waitForServer(baseUrl, plan.startTimeoutMs ?? 20_000)
  if (startupStatus === null) {
    writeFileSync(OUT_PATH, JSON.stringify({
      serverStarted: false,
      autocannonAvailable: true,
      startLogTail: startLog.join('').slice(-8000),
      results: [],
    }, null, 2))
    child.kill('SIGKILL')
    return
  }

  const needsToken = plan.routes.some((route) => route.needsAuth)
  const token = needsToken ? await attemptToken(baseUrl) : null

  const durationSec = plan.durationSec ?? 5
  const results = []
  for (const route of plan.routes) {
    if (route.needsAuth && !token) {
      results.push({ route: route.path, method: route.method, levels: [], note: 'could not obtain an auth token for the ramp' })
      continue
    }
    const levels = []
    for (const users of plan.levels) {
      try {
        const json = runAutocannon(`${baseUrl}${route.path}`, users, durationSec, route.needsAuth ? token : null)
        levels.push(summarize(users, json))
      } catch (error) {
        levels.push({ users, error: String(error.message ?? error) })
      }
    }
    results.push({ route: route.path, method: route.method, levels })
  }

  child.kill('SIGKILL')

  writeFileSync(OUT_PATH, JSON.stringify({
    serverStarted: true,
    autocannonAvailable: true,
    authTokenObtained: Boolean(token) || !needsToken,
    durationSec,
    startLogTail: startLog.join('').slice(-8000),
    results,
  }, null, 2))
}

run()
  .catch((error) => {
    try {
      mkdirSync(OUT_DIR, { recursive: true })
      writeFileSync(OUT_PATH, JSON.stringify({
        serverStarted: false,
        autocannonAvailable: true,
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
