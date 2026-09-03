import type { PrismaClient } from '../../generated/prisma/client.js'
import { DataQuality, RoutePlaceKind, RoutePreference } from '../../generated/prisma/enums.js'
import { AppError } from '../../middleware/index.js'
import type { RankedRoute } from './exposure.service.js'
import type { RouteComparisonRequest } from './route-comparison.validation.js'

type PersistableRoute = RankedRoute & { estimatedExposureIndex: number; averagePm25: number; reductionFromFastestPercent: number; airQualityTimestamp: string; dataQuality: 'modeled_estimate' | 'partial_estimate' }

export type StoredComparison = {
  userId: string
  input: RouteComparisonRequest
  routes: PersistableRoute[]
  calculationVersion: string
}

export type StoredComparisonResult = { comparisonId: string; routeResultIds: Record<string, string> }

export class RouteComparisonRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async ownedRouteResult(userId: string, routeResultId: string) {
    const routeResult = await this.prisma.trRouteResult.findFirst({ where: { id: routeResultId, comparison: { userId } }, select: { id: true } })
    if (!routeResult) throw new AppError(404, 'route_result_not_found', 'Route result not found.', false)
    return routeResult
  }

  async findOwnedPlaceAssociation(userId: string, routeResultId: string, kind: keyof typeof RoutePlaceKind, ordinal: number, role?: string) {
    await this.ownedRouteResult(userId, routeResultId)
    const association = await this.prisma.trRoutePlace.findUnique({ where: { routeResultId_kind_ordinal: { routeResultId, kind: RoutePlaceKind[kind], ordinal } }, select: { id: true, placeId: true, placeIdRefreshedAt: true, role: true } })
    return association && association.role === (role ?? null) ? { id: association.id, placeId: association.placeId, placeIdRefreshedAt: association.placeIdRefreshedAt } : null
  }

  async refreshPlaceAssociation(userId: string, associationId: string, placeId: string) {
    const { count } = await this.prisma.trRoutePlace.updateMany({ where: { id: associationId, routeResult: { comparison: { userId } } }, data: { placeId, placeIdRefreshedAt: new Date() } })
    if (!count) throw new AppError(404, 'route_result_not_found', 'Route result not found.', false)
  }

  async savePlaceAssociations(userId: string, routeResultId: string, kind: keyof typeof RoutePlaceKind, associations: Array<{ placeId: string; ordinal: number; role?: string }>) {
    return this.prisma.$transaction(async (transaction) => {
      const owned = await transaction.trRouteResult.findFirst({ where: { id: routeResultId, comparison: { userId } }, select: { id: true } })
      if (!owned) throw new AppError(404, 'route_result_not_found', 'Route result not found.', false)
      return Promise.all(associations.map(({ placeId, ordinal, role }) => transaction.trRoutePlace.upsert({
        where: { routeResultId_kind_ordinal: { routeResultId, kind: RoutePlaceKind[kind], ordinal } },
        create: { routeResultId, kind: RoutePlaceKind[kind], ordinal, placeId, ...(role ? { role } : {}) },
        update: { placeId, role: role ?? null, placeIdRefreshedAt: new Date() },
        select: { id: true, ordinal: true },
      })))
    })
  }

  async create({ userId, input, routes, calculationVersion }: StoredComparison): Promise<StoredComparisonResult> {
    const comparison = await this.prisma.trRouteComparison.create({
      data: {
        userId,
        originLatitude: input.origin.latitude,
        originLongitude: input.origin.longitude,
        destinationLatitude: input.destination.latitude,
        destinationLongitude: input.destination.longitude,
        mode: input.mode,
        preference: input.preference === 'lower-exposure' ? RoutePreference.lower_exposure : RoutePreference.balanced,
        sensitiveUser: input.sensitiveUser,
        routeSource: 'Google Routes API',
        airQualitySource: input.departureOffsetsMinutes.some((offset) => offset > 0) ? 'Google Air Quality API current and forecast' : 'Google Air Quality API current conditions',
        calculationVersion,
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
            fewerConfirmedReportSignals: route.hazardSummary.fewerConfirmedReportSignals,
            activeDistanceMeters: Math.round(input.mode === 'TRANSIT' ? route.transitSummary?.walkingDistanceMeters ?? 0 : route.distanceMeters),
            activeDurationSeconds: Math.round(input.mode === 'TRANSIT' ? route.transitSummary?.walkingDurationSeconds ?? 0 : route.durationSeconds),
          })),
        },
      },
      select: { id: true, routes: { select: { id: true, providerRouteId: true } } },
    })
    return { comparisonId: comparison.id, routeResultIds: Object.fromEntries(comparison.routes.map((route) => [route.providerRouteId, route.id])) }
  }
}
