import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { createObjectStorageClient, env, hasObjectStorageConfiguration } from '../../../config/index.js'
import { AppError } from '../../../middleware/index.js'

function storage() {
  if (!hasObjectStorageConfiguration() || !env.S3_BUCKET || !env.S3_PUBLIC_BASE_URL) throw new AppError(503, 'report_storage_not_configured', 'Report image storage is not configured.', false)
  return { client: createObjectStorageClient(), bucket: env.S3_BUCKET, publicBaseUrl: env.S3_PUBLIC_BASE_URL.replace(/\/$/u, '') }
}

function publicUrl(baseUrl: string, key: string) {
  return `${baseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`
}

export async function putRoadReportImage(key: string, body: Buffer) {
  const { client, bucket, publicBaseUrl } = storage()
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'image/webp', ContentLength: body.length, CacheControl: 'public, max-age=86400', ServerSideEncryption: 'AES256' })).catch(() => { throw new AppError(502, 'report_image_upload_failed', 'A report image could not be stored.', true) })
  return publicUrl(publicBaseUrl, key)
}

export async function getRoadReportImage(key: string) {
  const { client, bucket } = storage()
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })).catch(() => { throw new AppError(404, 'report_image_not_found', 'Report image was not found.', false) })
  if (!result.Body) throw new AppError(404, 'report_image_not_found', 'Report image was not found.', false)
  return { body: Buffer.from(await result.Body.transformToByteArray()), contentType: result.ContentType ?? 'image/webp', etag: result.ETag }
}

export async function deleteRoadReportImage(key: string) {
  const { client, bucket } = storage()
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined)
}
