import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import Docker from 'dockerode'
import { env } from '../config/env.js'
import { logger } from '../utils/logger.js'

const execFileAsync = promisify(execFile)

const SANDBOX_IMAGE = 'proofloop-sandbox-node:latest'
const FALLBACK_IMAGE = 'node:20-alpine'
const MAX_LOG_BYTES = 256 * 1024

const docker = new Docker()

let dockerAvailable: boolean | null = null
let resolvedImage: string | null = null

/** Docker may be absent on dev machines — checks degrade to 'skipped'. */
export async function isDockerAvailable(): Promise<boolean> {
  if (dockerAvailable !== null) return dockerAvailable
  try {
    await docker.ping()
    dockerAvailable = true
  } catch {
    dockerAvailable = false
    logger.warn('Docker daemon is not reachable — sandbox checks will be skipped')
  }
  return dockerAvailable
}

export function dockerClient(): Docker {
  return docker
}

async function imageExists(image: string): Promise<boolean> {
  try {
    await docker.getImage(image).inspect()
    return true
  } catch {
    return false
  }
}

async function pullImage(image: string): Promise<void> {
  if (await imageExists(image)) return
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (error: Error | null, stream: NodeJS.ReadableStream | undefined) => {
      if (error || !stream) {
        reject(error ?? new Error('pull failed'))
        return
      }
      docker.modem.followProgress(stream, (progressError: Error | null) => {
        if (progressError) reject(progressError)
        else resolve()
      })
    })
  })
}

/** Ensures an image exists locally, pulling it once when needed. */
export async function ensureImage(image: string): Promise<boolean> {
  if (!(await isDockerAvailable())) return false
  if (await imageExists(image)) return true
  try {
    logger.info('Pulling docker image %s …', image)
    await pullImage(image)
    return true
  } catch (error) {
    logger.warn({ err: error, image }, 'Could not pull docker image')
    return false
  }
}

/**
 * Prefers the purpose-built sandbox image (sandbox/Dockerfile.node) and
 * falls back to plain node:20-alpine with the runner scripts bind-mounted.
 */
export async function ensureSandboxImage(): Promise<string | null> {
  if (resolvedImage) return resolvedImage
  if (!(await isDockerAvailable())) return null

  if (await imageExists(SANDBOX_IMAGE)) {
    resolvedImage = SANDBOX_IMAGE
    return resolvedImage
  }

  try {
    const sandboxDir = path.resolve('sandbox')
    const dockerfile = path.join(sandboxDir, 'Dockerfile.node')
    logger.info('Building %s from %s …', SANDBOX_IMAGE, dockerfile)
    await execFileAsync('docker', ['build', '-f', dockerfile, '-t', SANDBOX_IMAGE, sandboxDir], {
      timeout: 10 * 60_000,
      maxBuffer: 20 * 1024 * 1024,
    })
    resolvedImage = SANDBOX_IMAGE
  } catch (error) {
    logger.warn({ err: error }, 'Sandbox image build failed — falling back to %s', FALLBACK_IMAGE)
    try {
      await pullImage(FALLBACK_IMAGE)
      resolvedImage = FALLBACK_IMAGE
    } catch (pullError) {
      logger.warn({ err: pullError }, 'Could not obtain a sandbox image')
      return null
    }
  }
  return resolvedImage
}

export interface SandboxMount {
  hostPath: string
  containerPath: string
  readOnly?: boolean
}

export type SandboxNetwork = 'none' | 'bridge'

export interface ContainerSpec {
  image: string
  /** Executed as-is (no shell wrapping) — pass ['sh', '-c', …] when a shell is needed. */
  cmd: string[]
  binds?: string[]
  network: SandboxNetwork
  env?: string[]
  workDir?: string
  memoryMB?: number
  cpus?: number
  pidsLimit?: number
  timeoutSec?: number
  /** Overrides the image entrypoint ([] to run the binary named in `cmd`). */
  entrypoint?: string[]
}

export interface SandboxResult {
  ran: boolean
  exitCode: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  durationMs: number
  error?: string
}

function trimLogs(buffer: Buffer): string {
  if (buffer.length <= MAX_LOG_BYTES) return buffer.toString('utf8')
  return `… (truncated) …\n${buffer.subarray(buffer.length - MAX_LOG_BYTES).toString('utf8')}`
}

/**
 * Runs one command in an ephemeral container:
 *  - CPU / memory / PID limits
 *  - hard wall-clock timeout → SIGKILL
 *  - host filesystem only ever bound in explicitly
 *  - the container is removed afterwards, success or failure
 */
export async function runContainer(spec: ContainerSpec): Promise<SandboxResult> {
  const startedAt = Date.now()
  const timeoutSec = spec.timeoutSec ?? env.SANDBOX_TIMEOUT_SEC

  let container: Docker.Container | null = null
  let timedOut = false

  try {
    container = await docker.createContainer({
      Image: spec.image,
      Cmd: spec.cmd,
      ...(spec.entrypoint ? { Entrypoint: spec.entrypoint } : {}),
      ...(spec.workDir ? { WorkingDir: spec.workDir } : {}),
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Env: spec.env ?? [],
      HostConfig: {
        NetworkMode: spec.network,
        Binds: spec.binds ?? [],
        Memory: (spec.memoryMB ?? env.SANDBOX_MEMORY_MB) * 1024 * 1024,
        NanoCpus: Math.round((spec.cpus ?? env.SANDBOX_CPU_LIMIT) * 1_000_000_000),
        PidsLimit: spec.pidsLimit ?? 512,
        Tmpfs: { '/tmp': 'rw,exec,size=256m' },
        SecurityOpt: ['no-new-privileges'],
      },
    })

    const stream = await container.attach({ stream: true, stdout: true, stderr: true })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    // Demux docker's framed stream (stdout/stderr interleaved by 8-byte header).
    let buffer = Buffer.alloc(0)
    stream.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 8) {
        const frameSize = buffer.readUInt32BE(4)
        if (buffer.length < 8 + frameSize) break
        const streamType = buffer[0]
        const payload = buffer.subarray(8, 8 + frameSize)
        if (streamType === 1) stdoutChunks.push(payload)
        else if (streamType === 2) stderrChunks.push(payload)
        buffer = buffer.subarray(8 + frameSize)
      }
    })

    await container.start()

    const waitPromise = container.wait().then((result) => result.StatusCode as number)
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), timeoutSec * 1000).unref()
    })
    const exitCode = await Promise.race([waitPromise, timeoutPromise])

    if (exitCode === null) {
      timedOut = true
      try {
        await container.kill()
      } catch {
        // already dead
      }
      await waitPromise.catch(() => undefined)
    }

    // Let remaining stream data flush before detaching.
    await new Promise((resolve) => setTimeout(resolve, 150))

    return {
      ran: true,
      exitCode: timedOut ? null : exitCode,
      timedOut,
      stdout: trimLogs(Buffer.concat(stdoutChunks)),
      stderr: trimLogs(Buffer.concat(stderrChunks)),
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      ran: false,
      exitCode: null,
      timedOut,
      stdout: '',
      stderr: '',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'sandbox failure',
    }
  } finally {
    if (container) {
      try {
        await container.remove({ force: true, v: true })
      } catch {
        // container may already be removed
      }
    }
  }
}

export interface SandboxOptions {
  /** Host directory mounted read-write at /workspace. */
  workspaceDir: string
  /** Shell command executed inside the container (via sh -c). */
  command: string
  network: SandboxNetwork
  extraMounts?: SandboxMount[]
  timeoutSec?: number
  env?: Record<string, string>
}

/** Runs a shell command in the project sandbox image with /workspace mounted. */
export async function runInSandbox(options: SandboxOptions): Promise<SandboxResult> {
  const image = await ensureSandboxImage()
  if (!image) {
    return {
      ran: false,
      exitCode: null,
      timedOut: false,
      stdout: '',
      stderr: '',
      durationMs: 0,
      error: 'Docker is unavailable',
    }
  }

  const binds = [`${options.workspaceDir}:/workspace`]
  for (const mount of options.extraMounts ?? []) {
    binds.push(`${mount.hostPath}:${mount.containerPath}${mount.readOnly ? ':ro' : ''}`)
  }

  return runContainer({
    image,
    cmd: ['sh', '-c', options.command],
    binds,
    network: options.network,
    workDir: '/workspace',
    env: [
      'CI=1',
      'NO_COLOR=1',
      'NODE_ENV=test',
      'npm_config_audit=false',
      'npm_config_fund=false',
      ...Object.entries(options.env ?? {}).map(([key, value]) => `${key}=${value}`),
    ],
    ...(options.timeoutSec !== undefined ? { timeoutSec: options.timeoutSec } : {}),
  })
}

/** Runs a third-party analysis tool image (Semgrep, Gitleaks, …) ephemerally. */
export async function runToolContainer(options: {
  image: string
  cmd: string[]
  mounts: SandboxMount[]
  network: SandboxNetwork
  timeoutSec?: number
  memoryMB?: number
}): Promise<SandboxResult> {
  const binds = options.mounts.map(
    (mount) => `${mount.hostPath}:${mount.containerPath}${mount.readOnly ? ':ro' : ''}`,
  )
  return runContainer({
    image: options.image,
    cmd: options.cmd,
    // Tool images vary in their entrypoints; the host passes the full argv.
    entrypoint: [],
    binds,
    network: options.network,
    env: ['NO_COLOR=1'],
    memoryMB: options.memoryMB ?? 1024,
    ...(options.timeoutSec !== undefined ? { timeoutSec: options.timeoutSec } : {}),
  })
}
