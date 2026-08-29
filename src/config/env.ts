import { z } from 'zod'

const optionalString = z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional())
const optionalUrl = z.preprocess((value) => value === '' ? undefined : value, z.url().optional())

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  FRONTEND_ORIGIN: z.url().default('http://localhost:5173'),
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  BETTER_AUTH_SECRET: z.string().min(32).default('development-only-secret-change-me'),
  DATABASE_URL: z.string().url().refine((value) => /^postgres(ql)?:\/\//u.test(value), 'DATABASE_URL must use PostgreSQL').default('postgresql://postgres:postgres@localhost:5432/aeroute'),
  GOOGLE_MAPS_SERVER_KEY: z.string().default(''),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SECURE: z.stringbool().default(false),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  S3_ENDPOINT: optionalUrl,
  S3_REGION: optionalString,
  S3_BUCKET: optionalString,
  S3_PUBLIC_BASE_URL: optionalUrl,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(8_000),
  TRUST_PROXY: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
})

export type Environment = z.infer<typeof schema>

export function parseEnvironment(input: NodeJS.ProcessEnv | Record<string, string | undefined>): Environment {
  const result = schema.safeParse(input)
  if (!result.success) throw new Error(`Invalid environment: ${z.prettifyError(result.error)}`)
  const environment = result.data
  if (Boolean(environment.GOOGLE_CLIENT_ID) !== Boolean(environment.GOOGLE_CLIENT_SECRET)) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together')
  const s3Configuration = [environment.S3_ENDPOINT, environment.S3_REGION, environment.S3_BUCKET, environment.S3_PUBLIC_BASE_URL, environment.S3_ACCESS_KEY_ID, environment.S3_SECRET_ACCESS_KEY]
  if (environment.NODE_ENV === 'production') {
    if (!s3Configuration.every(Boolean)) throw new Error('S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_PUBLIC_BASE_URL, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required in production')
    if (environment.BETTER_AUTH_SECRET === 'development-only-secret-change-me') throw new Error('BETTER_AUTH_SECRET must be replaced in production')
    if (!environment.FRONTEND_ORIGIN.startsWith('https://') || !environment.BETTER_AUTH_URL.startsWith('https://')) throw new Error('Production origins must use HTTPS')
    if (environment.DATABASE_URL === 'postgresql://postgres:postgres@localhost:5432/aeroute') throw new Error('DATABASE_URL must be configured for production')
    if (!environment.GOOGLE_MAPS_SERVER_KEY) throw new Error('GOOGLE_MAPS_SERVER_KEY is required in production')
    if (!environment.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is required in production')
    if (!environment.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET is required in production')
    if (!environment.SMTP_HOST || !environment.SMTP_USER || !environment.SMTP_PASSWORD) throw new Error('SMTP_HOST, SMTP_USER, and SMTP_PASSWORD are required in production')
  }
  return Object.freeze(environment)
}

export const env = parseEnvironment(process.env)
