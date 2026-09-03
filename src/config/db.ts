import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'
import { env } from './env.js'

const globalForPrisma = globalThis as unknown as { aeroutePrisma?: PrismaClient }

export function createPrisma(databaseUrl: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 300_000 }) })
}

export const prisma = globalForPrisma.aeroutePrisma ?? createPrisma(env.DATABASE_URL)
if (env.NODE_ENV !== 'production') globalForPrisma.aeroutePrisma = prisma
