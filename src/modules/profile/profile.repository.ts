import type { PrismaClient } from '../../generated/prisma/client.js'

export class ProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  findAvatar(userId: string) {
    return this.prisma.msUser.findUnique({ where: { id: userId }, select: { avatarKey: true } })
  }

  updateAvatar(userId: string, avatarKey: string, image: string) {
    return this.prisma.msUser.update({ where: { id: userId }, data: { avatarKey, image }, select: { image: true } })
  }

  removeAvatar(userId: string) {
    return this.prisma.msUser.update({ where: { id: userId }, data: { avatarKey: null, image: null } })
  }
}
