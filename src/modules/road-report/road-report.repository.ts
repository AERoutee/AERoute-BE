import type { PrismaClient, RoadReportCategory } from '../../generated/prisma/client.js'
import type { NearbyRoadReportsInput } from './road-report.validation.js'

export type StoredReportImage = { objectKey: string; imageUrl: string; position: number; width: number; height: number }

export class RoadReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  countRecentByUser(userId: string, since: Date) {
    return this.prisma.trRoadReport.count({ where: { userId, createdAt: { gte: since } } })
  }

  create(data: { id: string; userId: string; category: RoadReportCategory; description: string; latitude: number; longitude: number; expiresAt: Date; images: StoredReportImage[] }) {
    return this.prisma.trRoadReport.create({
      data: { id: data.id, userId: data.userId, category: data.category, description: data.description, latitude: data.latitude, longitude: data.longitude, expiresAt: data.expiresAt, images: { create: data.images } },
      select: { id: true, category: true, description: true, latitude: true, longitude: true, createdAt: true, expiresAt: true, images: { orderBy: { position: 'asc' }, select: { id: true } }, user: { select: { name: true } } },
    })
  }

  findImage(id: string) {
    return this.prisma.trRoadReportImage.findUnique({ where: { id }, select: { objectKey: true } })
  }

  findNearby(bounds: NearbyRoadReportsInput) {
    return this.prisma.trRoadReport.findMany({
      where: { latitude: { gte: bounds.south, lte: bounds.north }, longitude: { gte: bounds.west, lte: bounds.east }, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, category: true, description: true, latitude: true, longitude: true, createdAt: true, expiresAt: true, images: { orderBy: { position: 'asc' }, select: { id: true } }, user: { select: { name: true } } },
    })
  }
}
