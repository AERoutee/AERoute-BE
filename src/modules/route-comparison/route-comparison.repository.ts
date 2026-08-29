import type { PrismaClient } from '../../generated/prisma/client.js'
import { DataQuality, RoutePreference } from '../../generated/prisma/enums.js'
import type { RankedRoute } from './exposure.service.js'
import type { RouteComparisonRequest } from './route-comparison.validation.js'

export type StoredComparison = {
  userId: string
  input: RouteComparisonRequest
  routes: RankedRoute[]
}

export class RouteComparisonRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create({ userId, input, routes }: StoredComparison): Promise<string> {
    const comparison = await this.prisma.trRouteComparison.create({
      data: {
        userId,
        mode: input.mode,
        preference: input.preference === 'lower-exposure' ? RoutePreference.lower_exposure : RoutePreference.balanced,
        sensitiveUser: input.sensitiveUser,
        routeSource: 'Google Routes API',
        airQualitySource: 'Google Air Quality API current conditions',
        calculationVersion: 'pm25-time-v1',
        routes: {
          create: routes.map((route) => ({
            providerRouteId: route.id,
            labels: route.labels,
            durationSeconds: Math.round(route.durationSeconds),
            distanceMeters: Math.round(route.distanceMeters),
            estimatedExposureIndex: route.estimatedExposureIndex,
            averagePm25: route.averagePm25,
            reductionPercent: route.reductionFromFastestPercent,
            dataQuality: route.dataQuality === 'modeled_estimate' ? DataQuality.modeled_estimate : DataQuality.partial_estimate,
            airQualityTimestamp: new Date(route.airQualityTimestamp),
            encodedPolyline: route.encodedPolyline,
          })),
        },
      },
      select: { id: true },
    })
    return comparison.id
  }
}
