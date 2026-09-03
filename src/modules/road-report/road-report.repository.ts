import type { PrismaClient, RoadReportCategory, RoadReportVerdict } from '../../generated/prisma/client.js'
import type { NearbyRoadReportsInput } from './road-report.validation.js'

export type StoredReportImage = { objectKey: string; imageUrl: string; position: number; width: number; height: number }

const reportSelect = {
  id: true,
  userId: true,
  category: true,
  description: true,
  latitude: true,
  longitude: true,
  createdAt: true,
  expiresAt: true,
  resolvedAt: true,
  images: { orderBy: { position: 'asc' as const }, select: { id: true } },
  user: { select: { name: true } },
  verifications: { select: { userId: true, verdict: true } },
}

export class RoadReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  countRecentByUser(userId: string, since: Date) {
    return this.prisma.trRoadReport.count({ where: { userId, createdAt: { gte: since } } })
  }

  create(data: { id: string; userId: string; category: RoadReportCategory; description: string; latitude: number; longitude: number; expiresAt: Date; images: StoredReportImage[] }) {
    return this.prisma.trRoadReport.create({
      data: { id: data.id, userId: data.userId, category: data.category, description: data.description, latitude: data.latitude, longitude: data.longitude, expiresAt: data.expiresAt, images: { create: data.images } },
      select: reportSelect,
    })
  }

  findImage(id: string) {
    return this.prisma.trRoadReportImage.findUnique({ where: { id }, select: { objectKey: true, report: { select: { expiresAt: true, resolvedAt: true } } } })
  }

  findNearby(bounds: NearbyRoadReportsInput, now: Date) {
    return this.prisma.trRoadReport.findMany({
      where: { latitude: { gte: bounds.south, lte: bounds.north }, ...(bounds.west <= bounds.east ? { longitude: { gte: bounds.west, lte: bounds.east } } : { OR: [{ longitude: { gte: bounds.west } }, { longitude: { lte: bounds.east } }] }), expiresAt: { gt: now }, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: reportSelect,
    })
  }

  findActiveInBounds(bounds: NearbyRoadReportsInput, now: Date) {
    return this.prisma.trRoadReport.findMany({
      where: { latitude: { gte: bounds.south, lte: bounds.north }, ...(bounds.west <= bounds.east ? { longitude: { gte: bounds.west, lte: bounds.east } } : { OR: [{ longitude: { gte: bounds.west } }, { longitude: { lte: bounds.east } }] }), expiresAt: { gt: now }, resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: reportSelect,
    })
  }

  findMine(userId: string) {
    return this.prisma.trRoadReport.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100, select: reportSelect })
  }

  findById(id: string) {
    return this.prisma.trRoadReport.findUnique({ where: { id }, select: reportSelect })
  }

  verifyActive(reportId: string, userId: string, verdict: RoadReportVerdict, now: Date) {
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.trRoadReport.updateMany({ where: { id: reportId, userId: { not: userId }, resolvedAt: null, expiresAt: { gt: now } }, data: { updatedAt: now } })
      if (!active.count) return null
      await tx.trRoadReportVerification.upsert({ where: { reportId_userId: { reportId, userId } }, create: { reportId, userId, verdict }, update: { verdict } })
      return tx.trRoadReport.findUnique({ where: { id: reportId }, select: reportSelect })
    })
  }

  deleteVerification(reportId: string, userId: string) {
    return this.prisma.trRoadReportVerification.deleteMany({ where: { reportId, userId } })
  }

  resolveActive(id: string, userId: string, resolvedAt: Date) {
    return this.prisma.$transaction(async (tx) => {
      const resolved = await tx.trRoadReport.updateMany({ where: { id, userId, resolvedAt: null, expiresAt: { gt: resolvedAt } }, data: { resolvedAt } })
      if (!resolved.count) return null
      return tx.trRoadReport.findUnique({ where: { id }, select: reportSelect })
    })
  }
}
