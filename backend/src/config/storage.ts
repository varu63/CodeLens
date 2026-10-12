import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from './env.js'

export const ARTIFACT_URL_TTL_SECONDS = 15 * 60

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
})

export const bucket = env.S3_BUCKET

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }))
  }
}

export async function putObjectText(key: string, body: string, contentType = 'text/plain'): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  )
}

export async function putObjectBuffer(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  )
}

/** Returns the object body as text, or null when the key does not exist. */
export async function getObjectText(key: string): Promise<string | null> {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    if (!result.Body) return null
    return await result.Body.transformToString()
  } catch (error) {
    if (isNoSuchKey(error)) return null
    throw error
  }
}

export async function signedGetUrl(key: string, expiresIn = ARTIFACT_URL_TTL_SECONDS): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn })
}

/** Deletes every object under a prefix (e.g. all artifacts of a project). */
export async function deletePrefix(prefix: string): Promise<number> {
  let deleted = 0
  let continuationToken: string | undefined
  do {
    const listed = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    )
    for (const object of listed.Contents ?? []) {
      if (!object.Key) continue
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }))
      deleted += 1
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined
  } while (continuationToken)
  return deleted
}

function isNoSuchKey(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = (error as { name?: string }).name
  return name === 'NoSuchKey' || name === 'NotFound'
}
