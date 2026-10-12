import { putObjectText } from '../config/storage.js'
import { insertArtifact } from '../db/queries/artifacts.queries.js'
import type { ArtifactKindRow, ArtifactRow } from '../db/queries/artifacts.queries.js'
import { logger } from '../utils/logger.js'

/**
 * Persists a check-produced artifact: object storage first, an inline marker
 * as the fallback so the evidence reference still resolves when storage is down.
 */
export async function saveLogArtifact(
  runId: string,
  checkId: string,
  name: string,
  content: string,
  kind: ArtifactKindRow = 'log',
): Promise<ArtifactRow> {
  const key = `runs/${runId}/checks/${checkId}/${name}`
  let storageUrl = key
  try {
    await putObjectText(key, content, kind === 'log' ? 'text/plain' : 'application/json')
  } catch (error) {
    logger.warn({ err: error, runId, name }, 'Could not upload artifact to object storage')
    storageUrl = `inline:${name}`
  }
  return insertArtifact({
    runId,
    checkId,
    name,
    kind,
    storageUrl,
    sizeBytes: Buffer.byteLength(content),
  })
}
