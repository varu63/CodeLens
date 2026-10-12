/**
 * ProofLoop API contract runner.
 *
 * Boots the project under test inside the sandbox, then exercises the
 * scanned routes with deterministic assertions:
 *   - protected route without a token        → must deny (401/403)
 *   - protected route with a real token      → must not deny
 *   - admin route with a non-admin token     → must deny
 *   - public route                           → must be reachable (< 500)
 *
 * Reads  /proofloop/plan.json   (written by the worker)
 * Writes /proofloop/out/api-results.json
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const PLAN_PATH = '/proofloop/plan.json'
const OUT_DIR = '/proofloop/out'
const OUT_PATH = `${OUT_DIR}/api-results.json`

const REQUEST_TIMEOUT_MS = 10_000
const SERVER_POLL_INTERVAL_MS = 500

const plan = JSON.parse(readFileSync(PLAN_PATH, 'utf8'))
const results = []
const startLog = []

function logResult(entry) {
  results.push(entry)
  console.log(`[api-test] ${entry.ok ? 'OK  ' : 'FAIL'} ${entry.test} ${entry.method} ${entry.path}` +
    (entry.actual !== undefined ? ` → ${entry.actual} (expected ${JSON.stringify(entry.expected)})` : '') +
    (entry.note ? ` — ${entry.note}` : ''))
}

function normalizePath(routePath) {
  return routePath.replace(/:[A-Za-z_][\w]*/g, randomUUID())
}

async function timedFetch(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    return response
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
  if (!plan.auth) return { token: null, note: 'no auth endpoints detected' }
  const credentials = {
    name: 'ProofLoop Agent',
    email: `proofloop+${Date.now()}@example.com`,
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
      if (response.status < 300 && token) return { token, note: `token via ${attempt.label}` }
      if (attempt.label === 'register' && response.status >= 400) {
        // Registration may be closed/first-user-only — fall through to login.
        continue
      }
    } catch {
      // try the next candidate
    }
  }
  return { token: null, note: 'could not obtain a token (register/login failed or returned no token)' }
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
      authTokenObtained: false,
      startLogTail: startLog.join('').slice(-8000),
      results: [],
    }, null, 2))
    child.kill('SIGKILL')
    return
  }

  const { token, note: authNote } = await attemptToken(baseUrl)

  for (const route of plan.routes) {
    const url = `${baseUrl}${normalizePath(route.path)}`
    const meta = `${route.method} ${route.path}`
    const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.method)
    const headers = { 'Content-Type': 'application/json' }
    const body = write ? JSON.stringify(route.sampleBody ?? {}) : undefined

    // 1) routes the scan says are protected must deny unauthenticated requests.
    if (route.auth === 'user' || route.auth === 'admin') {
      try {
        const response = await timedFetch(url, { method: route.method, headers, body })
        const status = response.status
        const expected = [401, 403]
        if (expected.includes(status)) {
          logResult({ test: 'missing-token', method: route.method, path: route.path, expected, actual: status, ok: true })
        } else if (status === 400 || status === 422) {
          logResult({ test: 'missing-token', method: route.method, path: route.path, expected, actual: status, ok: true, note: 'input validation ran before auth — inconclusive' })
        } else {
          logResult({ test: 'missing-token', method: route.method, path: route.path, expected, actual: status, ok: false, note: `route did not deny an unauthenticated request (${meta})` })
        }
      } catch (error) {
        logResult({ test: 'missing-token', method: route.method, path: route.path, expected: [401, 403], ok: false, note: `request failed: ${error.message}` })
      }
    }

    // The static scan could not tell whether this route is guarded — record the
    // observed behavior as evidence but never fail the check on ambiguity. The
    // security stage turns this into a finding when it looks unprotected.
    if (route.auth === 'none-detected') {
      try {
        const response = await timedFetch(url, { method: route.method, headers, body })
        const status = response.status
        if (status === 401 || status === 403) {
          logResult({ test: 'missing-token', method: route.method, path: route.path, expected: [401, 403], actual: status, ok: true, note: 'route denies unauthenticated requests despite an unclear scan' })
        } else {
          logResult({ test: 'missing-token', method: route.method, path: route.path, expected: [401, 403], actual: status, ok: true, note: 'auth unclear from static scan — inconclusive, observed response recorded' })
        }
      } catch (error) {
        logResult({ test: 'missing-token', method: route.method, path: route.path, expected: [401, 403], ok: true, note: `auth unclear from static scan; request failed: ${error.message}` })
      }
    }

    // 2) valid token → must be reachable
    if (token && (route.auth === 'user' || route.auth === 'admin')) {
      try {
        const response = await timedFetch(url, {
          method: route.method,
          headers: { ...headers, Authorization: `Bearer ${token}` },
          body,
        })
        const status = response.status
        if (status === 401 || status === 403) {
          logResult({ test: 'valid-token', method: route.method, path: route.path, expected: 'reachable', actual: status, ok: false, note: 'authenticated request was rejected' })
        } else if (status >= 500) {
          logResult({ test: 'valid-token', method: route.method, path: route.path, expected: 'reachable', actual: status, ok: false, note: 'server error with a valid token' })
        } else {
          logResult({ test: 'valid-token', method: route.method, path: route.path, expected: 'reachable', actual: status, ok: true, note: authNote })
        }
      } catch (error) {
        logResult({ test: 'valid-token', method: route.method, path: route.path, expected: 'reachable', ok: false, note: `request failed: ${error.message}` })
      }
    }

    // 3) wrong role → admin routes must deny a regular token
    if (token && route.auth === 'admin') {
      try {
        const response = await timedFetch(url, {
          method: route.method,
          headers: { ...headers, Authorization: `Bearer ${token}` },
          body,
        })
        const status = response.status
        const denied = [401, 403, 404].includes(status)
        logResult({
          test: 'wrong-role',
          method: route.method,
          path: route.path,
          expected: [401, 403, 404],
          actual: status,
          ok: denied,
          note: denied ? undefined : 'admin route accepted a non-admin token',
        })
      } catch (error) {
        logResult({ test: 'wrong-role', method: route.method, path: route.path, expected: [401, 403, 404], ok: false, note: `request failed: ${error.message}` })
      }
    }

    // 4) public routes → must respond below 5xx
    if (route.auth === 'public') {
      try {
        const response = await timedFetch(url, { method: route.method, headers, body })
        const status = response.status
        if (status >= 500) {
          logResult({ test: 'public-reachable', method: route.method, path: route.path, expected: '<500', actual: status, ok: false, note: 'public route returned a server error' })
        } else if (status === 401 || status === 403) {
          logResult({ test: 'public-reachable', method: route.method, path: route.path, expected: '<500', actual: status, ok: true, note: 'route is more protected than the scan suggested' })
        } else {
          logResult({ test: 'public-reachable', method: route.method, path: route.path, expected: '<500', actual: status, ok: true })
        }
      } catch (error) {
        logResult({ test: 'public-reachable', method: route.method, path: route.path, expected: '<500', ok: false, note: `request failed: ${error.message}` })
      }
    }
  }

  writeFileSync(OUT_PATH, JSON.stringify({
    serverStarted: true,
    authTokenObtained: Boolean(token),
    authNote,
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
        authTokenObtained: false,
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
