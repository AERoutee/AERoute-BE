import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'

export class InsightsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  listSavedCommutes(userId: string) {
    return this.prisma.msSavedCommute.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
  }

  createSavedCommute(userId: string, data: Omit<Prisma.MsSavedCommuteUncheckedCreateInput, 'id' | 'userId' | 'createdAt' | 'updatedAt'>) {
    return this.prisma.msSavedCommute.create({ data: { ...data, userId } })
  }

  findSavedCommute(userId: string, id: string) {
    return this.prisma.msSavedCommute.findFirst({ where: { id, userId } })
  }

  updateSavedCommute(id: string, data: Prisma.MsSavedCommuteUpdateInput) {
    return this.prisma.msSavedCommute.update({ where: { id }, data })
  }

  deleteSavedCommute(id: string) {
    return this.prisma.msSavedCommute.delete({ where: { id } })
  }

  async findTripImpactSource(userId: string, routeResultId: string) {
    const source = await this.prisma.trRouteResult.findFirst({
      where: { id: routeResultId, comparison: { userId } },
      select: {
        comparison: {
          select: {
            id: true,
            mode: true,
            routes: { select: { id: true, labels: true, distanceMeters: true, durationSeconds: true, activeDistanceMeters: true, activeDurationSeconds: true, estimatedExposureIndex: true, fewerConfirmedReportSignals: true } },
          },
        },
      },
    })
    return source ? { comparisonId: source.comparison.id, mode: source.comparison.mode, routes: source.comparison.routes } : null
  }

  createTripImpact(userId: string, since: Date, limit: number, data: Omit<Prisma.TrTripImpactUncheckedCreateInput, 'id' | 'userId' | 'completedAt'>) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`
      const count = await transaction.trTripImpact.count({ where: { userId, completedAt: { gte: since } } })
      if (count >= limit) return null
      return transaction.trTripImpact.create({ data: { ...data, userId }, include: { routeResult: { select: { comparisonId: true } } } })
    })
  }

  listTripImpacts(userId: string) {
    return this.prisma.trTripImpact.findMany({ where: { userId }, orderBy: { completedAt: 'desc' }, include: { routeResult: { select: { comparisonId: true } } } })
  }
}
