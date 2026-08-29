import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { PrismaClient } from '../../generated/prisma/client.js'

const CHALLENGE_TTL_MS = 5 * 60 * 1000
const ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u

function hashId(id: string) {
  return createHash('sha256').update(id).digest('hex')
}

function identifier(id: string) {
  return `recovery:${hashId(id)}`
}

export class RecoveryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(email: string) {
    const id = randomBytes(32).toString('base64url')
    await this.prisma.trVerification.create({ data: { id: randomUUID(), identifier: identifier(id), value: email, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) } })
    return id
  }

  async find(id: string) {
    if (!ID_PATTERN.test(id)) return null
    const challenge = await this.prisma.trVerification.findFirst({ where: { identifier: identifier(id), expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })
    return challenge ? { email: challenge.value, expiresAt: challenge.expiresAt } : null
  }

  async consume(id: string) {
    if (!ID_PATTERN.test(id)) return
    await this.prisma.trVerification.deleteMany({ where: { identifier: identifier(id) } })
  }

  async removeExpired() {
    await this.prisma.trVerification.deleteMany({ where: { identifier: { startsWith: 'recovery:' }, expiresAt: { lte: new Date() } } })
  }
}
