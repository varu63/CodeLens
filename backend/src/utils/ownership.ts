import { notFound } from './errors.js'

/**
 * Owner checks for every project/run/finding/commit route.
 *
 * Returning 404 (never 403) for resources owned by someone else prevents IDOR
 * enumeration: an attacker cannot tell "exists but not yours" from "missing".
 */
export function assertOwned<T extends { userId: string }>(
  resource: T | null | undefined,
  userId: string,
  entity: string,
): T {
  if (!resource || resource.userId !== userId) {
    throw notFound(`${entity} not found`)
  }
  return resource
}
