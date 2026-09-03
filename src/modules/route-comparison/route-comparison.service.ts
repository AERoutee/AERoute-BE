import { randomUUID } from 'node:crypto'
import { AppError } from '../../middleware/index.js'
import { boundsForPoints, decodePolyline, encodePolyline, expandBounds, pointToPolylineDistanceMeters, samplePolyline, type GeoBounds, type GeoPoint } from '../../utils/index.js'
import type { RoadReportRepository } from '../road-report/road-report.repository.js'
import { rankRoutes, type HazardLevel, type HazardSummary, type RouteCandidate } from './exposure.service.js'
import { getRouteAirQuality } from './providers/google-air-quality.provider.js'
import { getPlacePhoto, getRestStopCandidates } from './providers/google-places.provider.js'
import { getRoutes, type CompositeSegment, type NavigationStep, type ProviderRoute, type TransitSegment } from './providers/google-routes.provider.js'
import { getForecastWeather } from './providers/google-weather.provider.js'
import type { RouteComparisonRepository } from './route-comparison.repository.js'
import type { RouteComparisonRequest } from './route-comparison.validation.js'
import { evaluateWeatherAdvisory, summarizeHeatUv, type WeatherConditions } from './weather-advisory.service.js'

const CALCULATION_VERSION = 'route-intelligence-v2'
const HAZARD_DISTANCE_METERS = 100
const REST_STOP_DISTANCE_METERS = 250
const WEATHER_CHECKPOINTS = 5

type ActiveReport = NonNullable<Awaited<ReturnType<RoadReportRepository['findActiveInBounds']>>>[number]

function geometry(route: ProviderRoute) {
  try {
    const points = decodePolyline(route.encodedPolyline)
    if (!points.length) throw new RangeError()
    return points
  } catch {
    throw new AppError(502, 'invalid_route_geometry', 'The route provider returned invalid route geometry.', true)
  }
}

function combinedBounds(routePoints: GeoPoint[][]): GeoBounds {
  const bounds = boundsForPoints(routePoints.flat())
  if (!bounds) throw new AppError(502, 'invalid_route_geometry', 'The route provider returned invalid route geometry.', true)
  return expandBounds(bounds, HAZARD_DISTANCE_METERS)
}

function reportConfidence(report: ActiveReport, now: Date) {
  const confirmations = report.verifications.filter((item) => item.verdict === 'CONFIRM').length
  const disputes = report.verifications.length - confirmations
  const netConfirmations = Math.max(0, confirmations - disputes)
  const recency = Math.max(0, Math.min(40, Math.round((1 - (now.getTime() - report.createdAt.getTime()) / Math.max(1, report.expiresAt.getTime() - report.createdAt.getTime())) * 40)))
  const score = Math.max(0, Math.min(100, recency + Math.min(30, report.images.length * 10) + Math.min(30, netConfirmations * 15)))
  return { confirmations, disputes, netConfirmations, score, level: netConfirmations >= 2 && score >= 70 ? 'HIGH' as const : score >= 40 ? 'MEDIUM' as const : 'LOW' as const }
}

function reportHazardLevel(category: ActiveReport['category'], distance: number): Exclude<HazardLevel, 'NONE_REPORTED'> {
  if (distance <= 50 && (category === 'CRASH' || category === 'BLOCKED_PATH')) return 'HIGH'
  if (distance <= 50 || category === 'CRASH' || category === 'BLOCKED_PATH' || category === 'HAZARD') return 'MEDIUM'
  return 'LOW'
}

const hazardWeight: Record<HazardLevel, number> = { NONE_REPORTED: 0, LOW: 1, MEDIUM: 2, HIGH: 3 }

function hazardsForRoute(points: GeoPoint[], reports: ActiveReport[], now: Date): Omit<HazardSummary, 'fewerConfirmedReportSignals'> {
  const nearby = reports.flatMap((report) => {
    const distance = pointToPolylineDistanceMeters({ latitude: report.latitude, longitude: report.longitude }, points)
    if (distance > HAZARD_DISTANCE_METERS) return []
    const trust = reportConfidence(report, now)
    return [{ id: report.id, category: report.category, distanceMeters: Math.round(distance), confidence: trust.level, confirmations: trust.confirmations, disputes: trust.disputes, netConfirmations: trust.netConfirmations, level: reportHazardLevel(report.category, distance) }]
  }).sort((left, right) => hazardWeight[right.level] - hazardWeight[left.level] || left.distanceMeters - right.distanceMeters || left.id.localeCompare(right.id))
  const confirmed = nearby.filter((report) => report.netConfirmations > 0)
  return {
    level: nearby[0]?.level ?? 'NONE_REPORTED',
    reports: nearby.map(({ level: _level, netConfirmations: _netConfirmations, ...report }) => report),
    nearbyCount: nearby.length,
    confirmedCount: confirmed.length,
    confirmedReportSignalScore: confirmed.reduce((total, report) => total + hazardWeight[report.level] * report.netConfirmations * (report.confidence === 'HIGH' ? 3 : report.confidence === 'MEDIUM' ? 2 : 1), 0),
    limitations: ['Community reports are evidence signals, may be incomplete, and do not verify route conditions or the absence of hazards.', 'At most 500 active reports inside the combined route bounds are assessed.'],
  }
}

function unavailableDeparture(offsetMinutes: number, warning: string) {
  return { offsetMinutes, status: 'UNAVAILABLE' as const, routes: [], recommendedRouteId: null, temporalResolution: 'HOURLY_BUCKET' as const, approximate: true, warning }
}

const COMPOSITE_LIMITATIONS = [
  'Bicycle parking is required at the first transit stop and is unverified.',
  'Onboard bicycle carriage is unknown.',
  'Preferred transit modes are not guaranteed; actual modes are disclosed.',
  'Walk and bike routes may omit dedicated paths.',
  'Exposure estimates are comparative only.',
  'Hazard signals use the complete displayed geometry and may include the transit corridor.',
]
const ACTIVE_TRAVEL_BETA_WARNING = 'Google Maps walking and cycling routes are in beta and may be incomplete.'

function appendGeometry(target: GeoPoint[], encodedPolyline: string) {
  const points = decodePolyline(encodedPolyline)
  if (!points.length) throw new RangeError()
  for (const point of points) {
    const previous = target.at(-1)
    if (!previous || previous.latitude !== point.latitude || previous.longitude !== point.longitude) target.push(point)
  }
}

function infeasibleFeederError(error: unknown) {
  return error instanceof AppError && (error.code === 'cycling_route_unavailable' || error.code === 'walking_route_unavailable')
}

function permanentProviderError(error: unknown) {
  return error instanceof AppError && !error.retryable && !infeasibleFeederError(error)
}

function completeStep(segment: TransitSegment): segment is TransitSegment & { durationSeconds: number; distanceMeters: number; encodedPolyline: string } {
  return segment.durationSeconds !== undefined && segment.distanceMeters !== undefined && Boolean(segment.encodedPolyline)
}

function segmentNavigationStep(segment: TransitSegment): NavigationStep[] {
  return segment.instruction ? [{ instruction: segment.instruction, ...(segment.maneuver ? { maneuver: segment.maneuver } : {}), travelMode: segment.travelMode, ...(segment.durationSeconds !== undefined ? { durationSeconds: segment.durationSeconds } : {}), ...(segment.distanceMeters !== undefined ? { distanceMeters: segment.distanceMeters } : {}), ...(segment.encodedPolyline ? { encodedPolyline: segment.encodedPolyline } : {}), ...(segment.startLocation ? { startLocation: segment.startLocation } : {}), ...(segment.endLocation ? { endLocation: segment.endLocation } : {}) }] : []
}

async function composeRoutes(input: RouteComparisonRequest, now: Date): Promise<ProviderRoute[]> {
  const transitRoutes = (await getRoutes(input, 0, now)).slice(0, 2)
  const composed: ProviderRoute[] = []
  let attemptedCandidates = 0
  let retryableFailures = 0
  let definitiveInfeasible = false
  for (const route of transitRoutes) {
    const summary = route.transitSummary
    const firstTransitIndex = summary?.segments.findIndex((segment) => 'travelMode' in segment && segment.travelMode === 'TRANSIT') ?? -1
    const lastTransitIndex = summary?.segments.reduce((last, segment, index) => 'travelMode' in segment && segment.travelMode === 'TRANSIT' ? index : last, -1) ?? -1
    if (!summary || firstTransitIndex < 0 || lastTransitIndex < firstTransitIndex) continue
    const included = summary.segments.slice(firstTransitIndex, lastTransitIndex + 1) as TransitSegment[]
    const firstTransit = included[0]
    const lastTransit = included.at(-1)!
    const departureStop = firstTransit.departureStop
    const arrivalStop = lastTransit.arrivalStop
    const departureTime = firstTransit.departureTime ? new Date(firstTransit.departureTime).getTime() : Number.NaN
    if (!departureStop?.location || !arrivalStop?.location || !Number.isFinite(departureTime) || included.some((segment) => !completeStep(segment) || segment.travelMode !== 'TRANSIT' && segment.travelMode !== 'WALK')) continue
    const transitSegments: CompositeSegment[] = []
    let previousArrival: number | undefined
    let transferWalkSeconds = 0
    let validSchedule = true
    for (const segment of included) {
      const { travelMode, ...details } = segment
      if (travelMode === 'WALK') {
        transferWalkSeconds += segment.durationSeconds!
        transitSegments.push({ ...details, role: 'TRANSFER_WALK', source: 'GOOGLE_ROUTES', mode: 'WALK', durationSeconds: segment.durationSeconds!, distanceMeters: segment.distanceMeters! })
        continue
      }
      const rideDeparture = segment.departureTime ? new Date(segment.departureTime).getTime() : Number.NaN
      const rideArrival = segment.arrivalTime ? new Date(segment.arrivalTime).getTime() : Number.NaN
      if (!Number.isFinite(rideDeparture) || !Number.isFinite(rideArrival) || rideArrival < rideDeparture || Math.abs((rideArrival - rideDeparture) / 1000 - segment.durationSeconds!) > 1) {
        validSchedule = false
        break
      }
      if (previousArrival !== undefined) {
        const waitSeconds = (rideDeparture - previousArrival) / 1000 - transferWalkSeconds
        if (waitSeconds < 0) {
          validSchedule = false
          break
        }
        if (waitSeconds > 0) transitSegments.push({ role: 'WAIT', source: 'DERIVED_FROM_TRANSIT_SCHEDULE', mode: 'WAIT', durationSeconds: waitSeconds, distanceMeters: 0, ...(segment.departureStop?.location ? { location: segment.departureStop.location } : {}) })
      }
      transitSegments.push({ ...details, role: 'TRANSIT_RIDE', source: 'GOOGLE_ROUTES', mode: 'TRANSIT', durationSeconds: segment.durationSeconds!, distanceMeters: segment.distanceMeters! })
      previousArrival = rideArrival
      transferWalkSeconds = 0
    }
    if (!validSchedule) continue
    attemptedCandidates += 1
    try {
      const bicycle = (await getRoutes({ origin: input.origin, destination: departureStop.location, mode: 'BICYCLE', accessibilityMode: input.accessibilityMode }, 0, now, { computeAlternativeRoutes: false }))[0]
      if (!bicycle || !Number.isFinite(bicycle.durationSeconds) || !Number.isFinite(bicycle.distanceMeters) || !bicycle.encodedPolyline || now.getTime() + bicycle.durationSeconds * 1000 > departureTime) {
        definitiveInfeasible = true
        continue
      }
      const walking = (await getRoutes({ origin: arrivalStop.location, destination: input.destination, mode: 'WALK', accessibilityMode: input.accessibilityMode }, 0, now, { computeAlternativeRoutes: false }))[0]
      if (!walking || !Number.isFinite(walking.durationSeconds) || !Number.isFinite(walking.distanceMeters) || !walking.encodedPolyline) {
        definitiveInfeasible = true
        continue
      }
      const waitSeconds = (departureTime - now.getTime()) / 1000 - bicycle.durationSeconds
      if (waitSeconds < 0) {
        definitiveInfeasible = true
        continue
      }
      const points: GeoPoint[] = []
      appendGeometry(points, bicycle.encodedPolyline)
      for (const segment of included) appendGeometry(points, segment.encodedPolyline!)
      appendGeometry(points, walking.encodedPolyline)
      const segments: CompositeSegment[] = [
        { role: 'FIRST_MILE', source: 'GOOGLE_ROUTES', mode: 'BICYCLE', durationSeconds: bicycle.durationSeconds, distanceMeters: bicycle.distanceMeters, encodedPolyline: bicycle.encodedPolyline, startLocation: input.origin, endLocation: departureStop.location },
        { role: 'WAIT', source: 'DERIVED_FROM_TRANSIT_SCHEDULE', mode: 'WAIT', durationSeconds: waitSeconds, distanceMeters: 0, location: departureStop.location },
        ...transitSegments,
        { role: 'LAST_MILE', source: 'GOOGLE_ROUTES', mode: 'WALK', durationSeconds: walking.durationSeconds, distanceMeters: walking.distanceMeters, encodedPolyline: walking.encodedPolyline, startLocation: arrivalStop.location, endLocation: input.destination },
      ]
      composed.push({
        id: route.id,
        durationSeconds: segments.reduce((total, segment) => total + segment.durationSeconds, 0),
        distanceMeters: segments.reduce((total, segment) => total + segment.distanceMeters, 0),
        encodedPolyline: encodePolyline(points),
        providerLabels: route.providerLabels,
        warnings: Array.from(new Set([...(route.warnings ?? []), ...(bicycle.warnings ?? []), ...(walking.warnings ?? [])])),
        navigationSteps: [...(bicycle.navigationSteps ?? []), ...included.flatMap(segmentNavigationStep), ...(walking.navigationSteps ?? [])],
        composition: 'PROVIDER_SEGMENTS',
        scheduleStatus: 'SCHEDULE_VALIDATED',
        limitations: COMPOSITE_LIMITATIONS,
        transitSummary: {
          walkingDurationSeconds: transitSegments.filter((segment) => segment.mode === 'WALK').reduce((total, segment) => total + segment.durationSeconds, walking.durationSeconds),
          walkingDistanceMeters: transitSegments.filter((segment) => segment.mode === 'WALK').reduce((total, segment) => total + segment.distanceMeters, walking.distanceMeters),
          transfers: Math.max(0, transitSegments.filter((segment) => segment.mode === 'TRANSIT').length - 1),
          segments,
          stations: summary.stations,
          preferredTransitModes: input.transitModes ?? [],
          actualTransitModes: Array.from(new Set(transitSegments.flatMap((segment) => segment.vehicleType ? [segment.vehicleType] : []))),
        },
      })
    } catch (error) {
      if (permanentProviderError(error)) throw error
      if (infeasibleFeederError(error)) definitiveInfeasible = true
      if (error instanceof AppError && error.retryable) retryableFailures += 1
    }
  }
  if (!composed.length && attemptedCandidates > 0 && retryableFailures === attemptedCandidates && !definitiveInfeasible) throw new AppError(503, 'bike_transit_provider_unavailable', 'Bicycle or walking route providers are temporarily unavailable.', true)
  if (!composed.length) throw new AppError(422, 'bike_transit_unavailable', 'No bicycle route could connect to an available transit itinerary and walking last mile on schedule.', false)
  return composed
}

export class RouteComparisonService {
  constructor(private readonly repository: RouteComparisonRepository, private readonly roadReports?: RoadReportRepository) {}

  async photo(name: string) {
    return getPlacePhoto(name)
  }

  async compare(input: RouteComparisonRequest, userId: string) {
    if (input.accessibilityMode === 'STEP_FREE_REQUIRED') throw new AppError(422, 'accessibility_routing_unsupported', 'Step-free routing cannot be verified with the available route data. Choose standard or reduced-exertion approximation.', false)
    const now = new Date()
    const warnings: string[] = []
    const composite = Boolean(input.accessPlan)
    const offsets = Array.from(new Set([0, ...(input.departureOffsetsMinutes ?? [0, 30, 60])])).sort((left, right) => left - right)
    const baseRoutes = composite ? await composeRoutes(input, now) : input.mode === 'TRANSIT' ? null : await getRoutes(input, 0, now)
    const routesByOffset = await Promise.all(offsets.map(async (offset) => {
      try {
        return { offset, routes: baseRoutes ?? await getRoutes(input, offset, now) }
      } catch (error) {
        if (offset === 0) throw error
        return { offset, routes: null, warning: 'Routes are unavailable for this future departure window.' }
      }
    }))
    const allProviderRoutes = routesByOffset.flatMap((window) => window.routes ?? [])
    const allPoints = allProviderRoutes.map(geometry)
    const reports = this.roadReports && allPoints.length ? await this.roadReports.findActiveInBounds(combinedBounds(allPoints), now) : []
    const hazards = allPoints.map((points) => hazardsForRoute(points, reports, now))
    let routeCursor = 0
    const comparisons = []

    for (const window of routesByOffset) {
      if (!window.routes) {
        comparisons.push(unavailableDeparture(window.offset, window.warning!))
        warnings.push(window.warning!)
        continue
      }
      const hazardWindow = hazards.slice(routeCursor, routeCursor + window.routes.length)
      const maximumConfirmed = Math.max(0, ...hazardWindow.map((summary) => summary.confirmedCount))
      const windowHazards = hazardWindow.map((summary): HazardSummary => ({ ...summary, fewerConfirmedReportSignals: maximumConfirmed - summary.confirmedCount }))
      routeCursor += window.routes.length
      const departureTime = new Date(now.getTime() + window.offset * 60_000)
      const candidateResults = await Promise.allSettled(window.routes.map(async (route, routeIndex): Promise<RouteCandidate> => {
        const points = samplePolyline(geometry(route), WEATHER_CHECKPOINTS)
        const airQuality = await getRouteAirQuality(route.encodedPolyline, departureTime, route.durationSeconds, now).catch((error) => {
          if (error instanceof AppError && !error.retryable) throw error
          return { averagePm25: null, timestamp: null, dataQuality: 'unavailable' as const, sampleCount: 0, expectedSampleCount: WEATHER_CHECKPOINTS, samples: [] }
        })
        const weatherConditions = await Promise.all(points.map((point, pointIndex) => {
          const progress = points.length === 1 ? 0 : pointIndex / (points.length - 1)
          const target = new Date(departureTime.getTime() + route.durationSeconds * progress * 1000)
          return getForecastWeather(point, target, now).catch((): WeatherConditions => ({ status: 'unavailable' }))
        }))
        return {
          ...route,
          averagePm25: airQuality.averagePm25,
          airQualityTimestamp: airQuality.timestamp,
          dataQuality: airQuality.dataQuality,
          airQualitySampleCount: airQuality.sampleCount,
          airQualityExpectedSampleCount: airQuality.expectedSampleCount,
          airQualitySamples: airQuality.samples,
          hazardSummary: windowHazards[routeIndex],
          heatUv: summarizeHeatUv(weatherConditions),
          weatherConditions,
        }
      }))
      const providerError = candidateResults.find((result): result is PromiseRejectedResult => result.status === 'rejected' && result.reason instanceof AppError && !result.reason.retryable) ?? candidateResults.find((result): result is PromiseRejectedResult => result.status === 'rejected' && result.reason instanceof AppError)
      if (providerError && window.offset === 0 && candidateResults.every((result) => result.status === 'rejected')) throw providerError.reason
      const candidates = candidateResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
      if (!candidates.length) {
        const warning = providerError && !providerError.reason.retryable ? `Future air-quality configuration error: ${providerError.reason.code}.` : 'Air-quality forecasts are unavailable for this future departure window.'
        comparisons.push(unavailableDeparture(window.offset, warning))
        warnings.push(warning)
        continue
      }
      if (candidates.length < window.routes.length) warnings.push(`Some routes are unavailable for the +${window.offset}-minute departure comparison.`)
      const routes = rankRoutes(candidates, { preference: input.preference, sensitiveUser: input.sensitiveUser, hazardPolicy: input.hazardPolicy, accessibilityMode: input.accessibilityMode })
      const recommended = routes.find((route) => route.labels.includes('RECOMMENDED')) ?? routes[0]
      const weatherAdvisory = evaluateWeatherAdvisory(recommended.weatherConditions, input.mode)
      comparisons.push({
        offsetMinutes: window.offset,
        status: 'AVAILABLE' as const,
        routes,
        recommendedRouteId: recommended.id,
        temporalResolution: window.offset === 0 ? 'CURRENT_CONDITIONS' as const : 'HOURLY_BUCKET' as const,
        approximate: window.offset > 0,
        weatherAdvisory,
        heatUv: recommended.heatUv,
      })
    }

    const current = comparisons.find((comparison) => comparison.offsetMinutes === 0)
    if (!current || current.status !== 'AVAILABLE') throw new AppError(503, 'current_route_comparison_unavailable', 'The current route comparison is unavailable.', true)
    const recommended = current.routes.find((route) => route.labels.includes('RECOMMENDED')) ?? current.routes[0]
    let comparisonId: string = randomUUID()
    let responseRoutes = current.routes
    let recommendedRouteResultId: string | undefined
    const airQualityUnavailable = current.routes.some((route) => route.dataQuality === 'unavailable')
    if (!composite && !airQualityUnavailable) {
      const stored = await this.repository.create({ userId: userId!, input, routes: current.routes as Array<typeof current.routes[number] & { estimatedExposureIndex: number; averagePm25: number; reductionFromFastestPercent: number; airQualityTimestamp: string; dataQuality: 'modeled_estimate' | 'partial_estimate' }>, calculationVersion: CALCULATION_VERSION })
      comparisonId = stored.comparisonId
      recommendedRouteResultId = stored.routeResultIds[recommended.id]
      responseRoutes = current.routes.map((route) => ({ ...route, routeResultId: stored.routeResultIds[route.id] }))
      current.routes = responseRoutes
    }
    let restStops = input.includeRestStops ? await getRestStopCandidates(recommended.encodedPolyline) : { status: 'NOT_REQUESTED' as const, candidates: [] }
    if (restStops.status === 'AVAILABLE') {
      const routePoints = geometry(recommended)
      restStops = { ...restStops, candidates: restStops.candidates.filter((candidate) => pointToPolylineDistanceMeters(candidate.location, routePoints) <= REST_STOP_DISTANCE_METERS) }
    }
    if (restStops.status === 'AVAILABLE' && recommendedRouteResultId) {
      const associations = await this.repository.savePlaceAssociations(userId, recommendedRouteResultId, 'REST_STOP', restStops.candidates.map((candidate, ordinal) => ({ placeId: candidate.id, ordinal })))
      const associationIds = new Map(associations.map((association) => [association.ordinal, association.id]))
      restStops = { ...restStops, candidates: restStops.candidates.map((candidate, ordinal) => ({ ...candidate, associationId: associationIds.get(ordinal) })) }
    }
    if (restStops.status === 'UNAVAILABLE') warnings.push(restStops.warning)
    if (airQualityUnavailable) warnings.push('PM2.5 data is temporarily unavailable; routes are ranked without air-quality exposure.')
    else if (current.routes.some((route) => route.dataQuality === 'partial_estimate')) warnings.push('Some route samples were unavailable; this comparison uses partial air-quality coverage.')
    if (input.accessibilityMode === 'REDUCED_EXERTION') warnings.push('Reduced exertion is an approximation and does not verify wheelchair access or step-free travel.')
    if (composite) warnings.push(ACTIVE_TRAVEL_BETA_WARNING, ...allProviderRoutes.flatMap((route) => route.warnings ?? []))
    return {
      comparisonId,
      persisted: !composite && !airQualityUnavailable,
      calculationVersion: CALCULATION_VERSION,
      routes: responseRoutes,
      departureComparisons: comparisons,
      cleanestDeparture: airQualityUnavailable ? null : [...comparisons].filter((comparison) => comparison.status === 'AVAILABLE').sort((left, right) => {
        const leftRoute = left.routes.find((route) => route.labels.includes('LOWEST_EXPOSURE')) ?? left.routes.find((route) => route.labels.includes('RECOMMENDED')) ?? left.routes[0]
        const rightRoute = right.routes.find((route) => route.labels.includes('LOWEST_EXPOSURE')) ?? right.routes.find((route) => route.labels.includes('RECOMMENDED')) ?? right.routes[0]
        return (leftRoute.estimatedExposureIndex ?? Number.POSITIVE_INFINITY) - (rightRoute.estimatedExposureIndex ?? Number.POSITIVE_INFINITY) || left.offsetMinutes - right.offsetMinutes
      })[0]?.offsetMinutes ?? null,
      weather: recommended.weatherConditions[Math.floor(recommended.weatherConditions.length / 2)] ?? { status: 'unavailable' as const },
      weatherPoints: samplePolyline(geometry(recommended), WEATHER_CHECKPOINTS).map((point, index) => ({ ...point, conditions: recommended.weatherConditions[index] })),
      weatherPointsByRoute: Object.fromEntries(current.routes.map((route) => [route.id, samplePolyline(geometry(route), WEATHER_CHECKPOINTS).map((point, index) => ({ ...point, conditions: route.weatherConditions[index] }))])),
      weatherAdvisory: current.weatherAdvisory,
      heatUv: current.heatUv,
      restStopCandidates: restStops,
      sourceDisclosure: {
        route: 'Google Routes API',
        airQuality: 'Google Air Quality API current conditions for offset 0 and hourly forecast buckets for future offsets',
        weather: 'Google Weather API hourly forecasts selected by closest interval to each route checkpoint target time',
        places: input.includeRestStops ? 'Google Places API Search Along Route candidates' : 'Not requested',
        communityReports: 'Active AERoute community reports matched within 100 meters of route geometry',
        temporalResolution: 'Future departure air quality uses HOURLY_BUCKET resolution and is approximate.',
        customScore: true as const,
      },
      warnings: Array.from(new Set(warnings)),
    }
  }
}
