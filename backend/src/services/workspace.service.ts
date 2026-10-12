import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import unzipper from 'unzipper'
import { env } from '../config/env.js'
import { badRequest } from '../utils/errors.js'

const execFileAsync = promisify(execFile)

const MAX_ARCHIVE_ENTRIES = 10_000
const MAX_EXTRACTED_BYTES = 500 * 1024 * 1024

/** Root under which every project gets an isolated source tree. */
export function storageRoot(): string {
  return path.resolve(env.STORAGE_DIR)
}

export function workspaceDir(projectId: string): string {
  return path.join(storageRoot(), 'projects', projectId, 'source')
}

/** Guards against zip-slip: entry must stay inside the extraction root. */
function safeEntryPath(root: string, entryPath: string): string | null {
  if (!entryPath || entryPath.includes('\0')) return null
  const normalized = entryPath.replace(/\\/g, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null
  const segments = normalized.split('/')
  if (segments.some((seg) => seg === '..')) return null
  const target = path.resolve(root, ...segments)
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep
  if (!target.startsWith(rootWithSep) && target !== root) return null
  return target
}

export async function removeWorkspace(projectId: string): Promise<void> {
  await rm(path.join(storageRoot(), 'projects', projectId), { recursive: true, force: true })
}

/**
 * Shallow-clones a repository into the project workspace.
 * Uses execFile (no shell) so the URL never reaches a shell parser.
 */
export async function cloneRepository(
  projectId: string,
  gitUrl: string,
  branch?: string,
): Promise<string> {
  const dir = workspaceDir(projectId)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const args = ['clone', '--depth', '50', '--single-branch']
  if (branch) args.push('--branch', branch)
  args.push('--', gitUrl, dir)

  try {
    await execFileAsync('git', args, {
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'echo',
        GCM_INTERACTIVE: 'never',
      },
    })
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? ''
    throw badRequest(
      `Could not clone repository. ${stderr.split('\n')[0]?.trim() || 'Check the URL and branch.'}`,
      'CLONE_FAILED',
    )
  }
  return dir
}

export interface ExtractResult {
  filesDetected: number
  bytesExtracted: number
}

/**
 * Extracts a zip archive into the project workspace.
 * Every entry is validated against path traversal before writing.
 */
export async function extractZipArchive(projectId: string, buffer: Buffer): Promise<ExtractResult> {
  const dir = workspaceDir(projectId)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  let archive: unzipper.CentralDirectory
  try {
    archive = await unzipper.Open.buffer(buffer)
  } catch {
    throw badRequest('The uploaded file is not a valid zip archive.', 'INVALID_ARCHIVE')
  }

  if (archive.files.length > MAX_ARCHIVE_ENTRIES) {
    throw badRequest('The archive contains too many files.', 'ARCHIVE_TOO_LARGE')
  }

  let filesDetected = 0
  let bytesExtracted = 0

  for (const entry of archive.files) {
    if (entry.type !== 'File') continue

    const target = safeEntryPath(dir, entry.path)
    if (!target) {
      await rm(dir, { recursive: true, force: true })
      throw badRequest('Archive contains an unsafe path.', 'ZIP_SLIP_DETECTED')
    }

    bytesExtracted += entry.uncompressedSize
    if (bytesExtracted > MAX_EXTRACTED_BYTES) {
      await rm(dir, { recursive: true, force: true })
      throw badRequest('Archive expands beyond the allowed size.', 'ARCHIVE_TOO_LARGE')
    }

    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, await entry.buffer())
    filesDetected += 1
  }

  if (filesDetected === 0) {
    throw badRequest('The archive is empty.', 'EMPTY_ARCHIVE')
  }
  return { filesDetected, bytesExtracted }
}
