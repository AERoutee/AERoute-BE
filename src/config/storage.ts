import { S3Client } from '@aws-sdk/client-s3'
import { env } from './env.js'

export function hasObjectStorageConfiguration() {
  return Boolean(env.S3_ENDPOINT && env.S3_REGION && env.S3_BUCKET && env.S3_PUBLIC_BASE_URL && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)
}

export function createObjectStorageClient() {
  if (!env.S3_ENDPOINT || !env.S3_REGION || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) throw new Error('Object storage is not configured')
  return new S3Client({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }, forcePathStyle: false })
}
