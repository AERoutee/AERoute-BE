import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { createObjectStorageClient, env, hasObjectStorageConfiguration } from '../../../config/index.js'
import { AppError } from '../../../middleware/index.js'

function storage() {
  if (!hasObjectStorageConfiguration() || !env.S3_BUCKET || !env.S3_PUBLIC_BASE_URL) throw new AppError(503, 'avatar_storage_not_configured', 'Profile photo storage is not configured.', false)
  return { client: createObjectStorageClient(), bucket: env.S3_BUCKET, publicBaseUrl: env.S3_PUBLIC_BASE_URL.replace(/\/$/u, '') }
}

function publicUrl(baseUrl: string, key: string) {
  return `${baseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`
}

async function verifyPublicRead(url: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5_000), headers: { Range: 'bytes=0-31' } }).catch(() => null)
    if (response?.ok && response.headers.get('content-type')?.startsWith('image/')) { await response.body?.cancel(); return true }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
  }
  return false
}

export async function putAvatar(key: string, body: Buffer) {
  const { client, bucket, publicBaseUrl } = storage()
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ACL: 'public-read', ContentType: 'image/webp', ContentLength: body.length, CacheControl: 'public, max-age=31536000, immutable', ServerSideEncryption: 'AES256' })).catch(() => { throw new AppError(502, 'avatar_upload_failed', 'Profile photo could not be stored.', true) })
  const url = publicUrl(publicBaseUrl, key)
  return { url, isPublic: await verifyPublicRead(url) }
}

export async function getAvatar(key: string) {
  const { client, bucket } = storage()
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })).catch(() => { throw new AppError(404, 'avatar_not_found', 'Profile photo was not found.', false) })
  if (!result.Body) throw new AppError(404, 'avatar_not_found', 'Profile photo was not found.', false)
  return Buffer.from(await result.Body.transformToByteArray())
}

export async function deleteAvatar(key: string) {
  const { client, bucket } = storage()
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => { throw new AppError(502, 'avatar_delete_failed', 'Profile photo could not be removed.', true) })
}
