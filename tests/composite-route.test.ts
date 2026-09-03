jest.mock('../src/config/index.js', () => ({ auth: { api: { getSession: jest.fn() } } }))
jest.mock('../src/modules/route-comparison/providers/google-routes.provider.js', () => ({ getRoutes: jest.fn() }))
jest.mock('../src/modules/route-comparison/providers/google-air-quality.provider.js', () => ({ getRouteAirQuality: jest.fn() }))
jest.mock('../src/modules/route-comparison/providers/google-weather.provider.js', () => ({ getForecastWeather: jest.fn() }))
jest.mock('../src/modules/route-comparison/providers/google-places.provider.js', () => ({ getRestStopCandidates: jest.fn() }))

import { AppError } from '../src/middleware/errors'
import { getRouteAirQuality } from '../src/modules/route-comparison/providers/google-air-quality.provider'
import { getRestStopCandidates } from '../src/modules/route-comparison/providers/google-places.provider'
import { getRoutes } from '../src/modules/route-comparison/providers/google-routes.provider'
import { getForecastWeather } from '../src/modules/route-comparison/providers/google-weather.provider'
import type { RouteComparisonRepository } from '../src/modules/route-comparison/route-comparison.repository'
import { RouteComparisonService } from '../src/modules/route-comparison/route-comparison.service'
import { routeComparisonRequestSchema } from '../src/modules/route-comparison/route-comparison.validation'
import { decodePolyline, encodePolyline } from '../src/utils/route-geometry'

const routesMock = jest.mocked(getRoutes)
const airQualityMock = jest.mocked(getRouteAirQuality)
const weatherMock = jest.mocked(getForecastWeather)
const placesMock = jest.mocked(getRestStopCandidates)
const point = (latitude: number, longitude: number) => ({ latitude, longitude })
const line = (...points: Array<{ latitude: number; longitude: number }>) => encodePolyline(points)
const accessPlan = { firstMileMode: 'BICYCLE' as const, lastMileMode: 'WALK' as const, bicyclePlan: 'PARK_AT_FIRST_TRANSIT_STOP' as const }
const input = {
  origin: point(-6.2, 106.8),
  destination: point(-6.25, 106.85),
  mode: 'TRANSIT' as const,
  preference: 'balanced' as const,
  sensitiveUser: false,
  accessibilityMode: 'STANDARD' as const,
  departureOffsetsMinutes: [0] as [0],
  hazardPolicy: 'PREFER_FEWER_REPORTS' as const,
  includeRestStops: false,
  transitModes: ['BUS'] as ['BUS'],
  accessPlan,
}
const stopA = point(-6.21, 106.81)
const stopB = point(-6.22, 106.82)
const stopC = point(-6.23, 106.83)
const stopD = point(-6.24, 106.84)
const transitRoute = {
  id: 'route_1',
  durationSeconds: 1800,
  distanceMeters: 9000,
  encodedPolyline: line(input.origin, input.destination),
  providerLabels: ['DEFAULT_ROUTE'],
  warnings: [],
  transitSummary: {
    walkingDurationSeconds: 120,
    walkingDistanceMeters: 150,
    transfers: 1,
    preferredTransitModes: ['BUS'],
    actualTransitModes: ['BUS', 'TRAIN'],
    segments: [
      { travelMode: 'WALK', durationSeconds: 300, distanceMeters: 400, encodedPolyline: line(input.origin, stopA), startLocation: input.origin, endLocation: stopA },
      { travelMode: 'TRANSIT', durationSeconds: 600, distanceMeters: 5000, encodedPolyline: line(stopA, stopB), startLocation: stopA, endLocation: stopB, vehicleType: 'BUS', lineName: 'Bus 1', departureTime: '2026-09-02T10:10:00.000Z', arrivalTime: '2026-09-02T10:20:00.000Z', departureStop: { name: 'A', location: stopA }, arrivalStop: { name: 'B', location: stopB } },
      { travelMode: 'WALK', durationSeconds: 120, distanceMeters: 150, encodedPolyline: line(stopB, stopC), startLocation: stopB, endLocation: stopC },
      { travelMode: 'TRANSIT', durationSeconds: 480, distanceMeters: 3000, encodedPolyline: line(stopC, stopD), startLocation: stopC, endLocation: stopD, vehicleType: 'TRAIN', lineName: 'Rail 2', departureTime: '2026-09-02T10:24:00.000Z', arrivalTime: '2026-09-02T10:32:00.000Z', departureStop: { name: 'C', location: stopC }, arrivalStop: { name: 'D', location: stopD } },
      { travelMode: 'WALK', durationSeconds: 300, distanceMeters: 400, encodedPolyline: line(stopD, input.destination), startLocation: stopD, endLocation: input.destination },
    ],
    stations: [{ name: 'A', location: stopA }, { name: 'B', location: stopB }, { name: 'C', location: stopC }, { name: 'D', location: stopD }],
  },
}
const bicycleRoute = { id: 'route_1', durationSeconds: 300, distanceMeters: 1200, encodedPolyline: line(input.origin, stopA), providerLabels: [] }
const walkRoute = { id: 'route_1', durationSeconds: 360, distanceMeters: 450, encodedPolyline: line(stopD, input.destination), providerLabels: [] }
const weather = { status: 'available' as const, observedAt: '2026-09-02T10:00:00.000Z', targetTime: '2026-09-02T10:00:00.000Z', forecastOffsetMinutes: 0, conditionType: 'CLEAR', condition: 'Clear', isDaytime: true, temperatureC: 28, feelsLikeC: 29, heatIndexC: 29, humidityPercent: 60, uvIndex: 4, precipitationProbabilityPercent: 0, thunderstormProbabilityPercent: 0, windSpeedKph: 5, windGustKph: 8, visibilityKm: 10 }

function repository() {
  return { create: jest.fn(), savePlaceAssociations: jest.fn() } as unknown as jest.Mocked<RouteComparisonRepository>
}

function roadReports() {
  return { findActiveInBounds: jest.fn().mockResolvedValue([]) }
}

function mockSuccessfulComposition(routes = [transitRoute]) {
  routesMock.mockImplementation(async (request) => request.mode === 'TRANSIT' ? routes as never : request.mode === 'BICYCLE' ? [bicycleRoute] : [walkRoute])
  airQualityMock.mockResolvedValue({ averagePm25: 10, timestamp: '2026-09-02T10:00:00.000Z', dataQuality: 'modeled_estimate', sampleCount: 5, expectedSampleCount: 5, samples: [], temporalResolution: 'CURRENT_CONDITIONS', approximate: false })
  weatherMock.mockResolvedValue(weather)
}

describe('bicycle transit walk composition validation', () => {
  it('accepts only the exact bounded access plan contract', () => {
    expect(routeComparisonRequestSchema.safeParse(input).success).toBe(true)
    const invalid = [
      { ...input, mode: 'WALK' },
      { ...input, departureOffsetsMinutes: [0, 30] },
      { ...input, includeRestStops: true },
      { ...input, accessibilityMode: 'STEP_FREE_REQUIRED' },
      { ...input, accessPlan: { ...accessPlan, firstMileMode: 'WALK' } },
      { ...input, accessPlan: { ...accessPlan, extra: true } },
    ]
    expect(invalid.every((value) => !routeComparisonRequestSchema.safeParse(value).success)).toBe(true)
  })
})

describe('bicycle transit walk composition service', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T10:00:00.000Z'))
    jest.resetAllMocks()
    mockSuccessfulComposition()
  })

  afterEach(() => jest.useRealTimers())

  it('builds scheduled provider segments, complete geometry, warnings, and an ephemeral comparison', async () => {
    const repo = repository()
    const result = await new RouteComparisonService(repo, roadReports() as never).compare(input, 'user-1')
    const route = result.routes[0]
    expect(routesMock).toHaveBeenCalledTimes(3)
    expect(routesMock.mock.calls[0][0].mode).toBe('TRANSIT')
    expect(routesMock.mock.calls.slice(1).every((call) => call[3]?.computeAlternativeRoutes === false)).toBe(true)
    expect(repo.create).not.toHaveBeenCalled()
    expect(repo.savePlaceAssociations).not.toHaveBeenCalled()
    expect(placesMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ comparisonId: expect.any(String), persisted: false, cleanestDeparture: 0, restStopCandidates: { status: 'NOT_REQUESTED', candidates: [] } })
    expect(result).not.toHaveProperty('routeResultId')
    expect(route).toMatchObject({ composition: 'PROVIDER_SEGMENTS', scheduleStatus: 'SCHEDULE_VALIDATED', durationSeconds: 2280, distanceMeters: 9800 })
    expect(route).not.toHaveProperty('routeResultId')
    expect(route.transitSummary.preferredTransitModes).toEqual(['BUS'])
    expect(route.transitSummary.actualTransitModes).toEqual(['BUS', 'TRAIN'])
    expect(route.transitSummary.segments.map((segment: { role: string }) => segment.role)).toEqual(['FIRST_MILE', 'WAIT', 'TRANSIT_RIDE', 'TRANSFER_WALK', 'WAIT', 'TRANSIT_RIDE', 'LAST_MILE'])
    expect(route.transitSummary.segments[1]).toMatchObject({ source: 'DERIVED_FROM_TRANSIT_SCHEDULE', mode: 'WAIT', durationSeconds: 300, distanceMeters: 0, location: stopA })
    expect(route.transitSummary.segments[4]).toMatchObject({ source: 'DERIVED_FROM_TRANSIT_SCHEDULE', mode: 'WAIT', durationSeconds: 120, distanceMeters: 0, location: stopC })
    expect(route.transitSummary.segments.reduce((total: number, segment: { durationSeconds: number }) => total + segment.durationSeconds, 0)).toBeCloseTo(route.durationSeconds, 6)
    expect(decodePolyline(route.encodedPolyline)).toEqual([input.origin, stopA, stopB, stopC, stopD, input.destination])
    expect(route.limitations).toEqual(expect.arrayContaining([
      expect.stringMatching(/parking.*required.*unverified/i),
      expect.stringMatching(/onboard bicycle carriage.*unknown/i),
      expect.stringMatching(/preferred transit modes.*not guaranteed/i),
      expect.stringMatching(/walk.*bike.*dedicated paths/i),
      expect.stringMatching(/exposure.*comparative only/i),
      expect.stringMatching(/hazard signals.*complete displayed geometry.*transit corridor/i),
    ]))
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/Google Maps.*walking.*cycling.*beta/i)]))
  })

  it('preserves feeder, retained transit, transfer, and last-mile navigation instructions in order', async () => {
    const instructedTransit = { ...transitRoute, transitSummary: { ...transitRoute.transitSummary, segments: transitRoute.transitSummary.segments.map((segment, index) => ({ ...segment, instruction: ['Old access walk', 'Naik Bus 1', 'Belok kiri ke peron berikutnya', 'Naik Rail 2', 'Old exit walk'][index], maneuver: ['STRAIGHT', 'STRAIGHT', 'TURN_LEFT', 'STRAIGHT', 'TURN_RIGHT'][index] })) } }
    const instructedBicycle = { ...bicycleRoute, navigationSteps: [{ instruction: 'Belok kanan ke jalur sepeda', maneuver: 'TURN_RIGHT', travelMode: 'BICYCLE', distanceMeters: 1200 }] }
    const instructedWalk = { ...walkRoute, navigationSteps: [{ instruction: 'Belok kiri menuju tujuan', maneuver: 'TURN_LEFT', travelMode: 'WALK', distanceMeters: 450 }] }
    routesMock.mockImplementation(async (request) => request.mode === 'TRANSIT' ? [instructedTransit] as never : request.mode === 'BICYCLE' ? [instructedBicycle] : [instructedWalk])

    const result = await new RouteComparisonService(repository(), roadReports() as never).compare(input, 'user-1')

    expect(result.routes[0].navigationSteps).toEqual([
      expect.objectContaining({ instruction: 'Belok kanan ke jalur sepeda', maneuver: 'TURN_RIGHT', travelMode: 'BICYCLE' }),
      expect.objectContaining({ instruction: 'Naik Bus 1', travelMode: 'TRANSIT' }),
      expect.objectContaining({ instruction: 'Belok kiri ke peron berikutnya', maneuver: 'TURN_LEFT', travelMode: 'WALK' }),
      expect.objectContaining({ instruction: 'Naik Rail 2', travelMode: 'TRANSIT' }),
      expect.objectContaining({ instruction: 'Belok kiri menuju tujuan', maneuver: 'TURN_LEFT', travelMode: 'WALK' }),
    ])
    expect(result.routes[0].navigationSteps?.map((step) => step.instruction)).not.toContain('Old access walk')
    expect(result.routes[0].navigationSteps?.map((step) => step.instruction)).not.toContain('Old exit walk')
  })

  it('retains at most two transit candidates and makes no more than five provider calls without active alternatives', async () => {
    const alternatives = [transitRoute, { ...transitRoute, id: 'route_2' }, { ...transitRoute, id: 'route_3' }]
    mockSuccessfulComposition(alternatives)
    const result = await new RouteComparisonService(repository(), roadReports() as never).compare(input, 'user-1')
    expect(result.routes).toHaveLength(2)
    expect(routesMock).toHaveBeenCalledTimes(5)
    expect(routesMock.mock.calls.slice(1).every((call) => call[3]?.computeAlternativeRoutes === false)).toBe(true)
  })

  it.each([
    ['missing stop coordinates', { ...transitRoute, transitSummary: { ...transitRoute.transitSummary, segments: transitRoute.transitSummary.segments.map((segment, index) => index === 1 ? { ...segment, departureStop: { name: 'A' } } : segment) } }],
    ['missing stop schedule', { ...transitRoute, transitSummary: { ...transitRoute.transitSummary, segments: transitRoute.transitSummary.segments.map((segment, index) => index === 1 ? { ...segment, departureTime: undefined } : segment) } }],
  ])('discards a candidate with %s', async (_name, invalidTransit) => {
    mockSuccessfulComposition([invalidTransit as never])
    await expect(new RouteComparisonService(repository()).compare(input, 'user-1')).rejects.toMatchObject({ statusCode: 422, code: 'bike_transit_unavailable' })
    expect(routesMock).toHaveBeenCalledTimes(1)
  })

  it('discards a missed connection and does not request the last mile', async () => {
    routesMock.mockImplementation(async (request) => request.mode === 'TRANSIT' ? [transitRoute] as never : request.mode === 'BICYCLE' ? [{ ...bicycleRoute, durationSeconds: 700 }] : [walkRoute])
    await expect(new RouteComparisonService(repository()).compare(input, 'user-1')).rejects.toMatchObject({ statusCode: 422, code: 'bike_transit_unavailable' })
    expect(routesMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['missing connecting departure', transitRoute.transitSummary.segments.map((segment, index) => index === 3 ? { ...segment, departureTime: undefined } : segment)],
    ['missing preceding arrival', transitRoute.transitSummary.segments.map((segment, index) => index === 1 ? { ...segment, arrivalTime: undefined } : segment)],
    ['negative transfer connection', transitRoute.transitSummary.segments.map((segment, index) => index === 3 ? { ...segment, departureTime: '2026-09-02T10:21:00.000Z' } : segment)],
    ['negative transit ride', transitRoute.transitSummary.segments.map((segment, index) => index === 3 ? { ...segment, arrivalTime: '2026-09-02T10:23:00.000Z' } : segment)],
  ])('rejects %s before feeder requests', async (_name, segments) => {
    mockSuccessfulComposition([{ ...transitRoute, transitSummary: { ...transitRoute.transitSummary, segments } }])
    await expect(new RouteComparisonService(repository()).compare(input, 'user-1')).rejects.toMatchObject({ statusCode: 422, code: 'bike_transit_unavailable' })
    expect(routesMock).toHaveBeenCalledTimes(1)
  })

  it.each(['BICYCLE', 'WALK'] as const)('surfaces retryable %s feeder failures when they prevent every composition', async (failedMode) => {
    routesMock.mockImplementation(async (request) => {
      if (request.mode === 'TRANSIT') return [transitRoute] as never
      if (request.mode === failedMode) throw new AppError(503, 'route_provider_unavailable', 'Routes are temporarily unavailable.', true)
      return request.mode === 'BICYCLE' ? [bicycleRoute] : [walkRoute]
    })
    await expect(new RouteComparisonService(repository()).compare(input, 'user-1')).rejects.toMatchObject({ statusCode: 503, code: 'bike_transit_provider_unavailable', retryable: true })
  })

  it.each([
    ['BICYCLE', 'cycling_route_unavailable'],
    ['WALK', 'walking_route_unavailable'],
  ] as const)('maps unsupported %s coverage honestly after trying candidates', async (mode, code) => {
    routesMock.mockImplementation(async (request) => {
      if (request.mode === 'TRANSIT') return [transitRoute, { ...transitRoute, id: 'route_2' }] as never
      if (request.mode === mode) throw new AppError(422, code, `No ${mode.toLowerCase()} route.`, false)
      return request.mode === 'BICYCLE' ? [bicycleRoute] : [walkRoute]
    })
    await expect(new RouteComparisonService(repository()).compare(input, 'user-1')).rejects.toMatchObject({ statusCode: 422, code: 'bike_transit_unavailable', message: expect.stringMatching(/bicycle route.*transit/i) })
    expect(routesMock).toHaveBeenCalledTimes(mode === 'BICYCLE' ? 3 : 5)
  })

  it('returns definitive 422 when transient and infeasible feeder outcomes are mixed', async () => {
    let bicycleCalls = 0
    routesMock.mockImplementation(async (request) => {
      if (request.mode === 'TRANSIT') return [transitRoute, { ...transitRoute, id: 'route_2' }] as never
      if (request.mode === 'BICYCLE' && bicycleCalls++ === 0) throw new AppError(503, 'route_provider_unavailable', 'Routes are temporarily unavailable.', true)
      if (request.mode === 'WALK') throw new AppError(422, 'walking_route_unavailable', 'No walking route.', false)
      return [bicycleRoute]
    })
    await expect(new RouteComparisonService(repository()).compare(input, 'user-1')).rejects.toMatchObject({ statusCode: 422, code: 'bike_transit_unavailable', retryable: false })
  })

  it('returns 503 when every feeder candidate actually attempted failed transiently', async () => {
    const invalidTransit = { ...transitRoute, id: 'route_invalid', transitSummary: { ...transitRoute.transitSummary, segments: transitRoute.transitSummary.segments.map((segment, index) => index === 1 ? { ...segment, departureStop: { name: 'A' } } : segment) } }
    routesMock.mockImplementation(async (request) => {
      if (request.mode === 'TRANSIT') return [invalidTransit, transitRoute] as never
      throw new AppError(503, 'route_provider_unavailable', 'Routes are temporarily unavailable.', true)
    })
    await expect(new RouteComparisonService(repository()).compare(input, 'user-1')).rejects.toMatchObject({ statusCode: 503, code: 'bike_transit_provider_unavailable', retryable: true })
    expect(routesMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces permanent provider configuration errors', async () => {
    routesMock.mockResolvedValueOnce([transitRoute] as never).mockRejectedValueOnce(new AppError(503, 'route_provider_not_configured', 'The route provider is not configured.', false))
    await expect(new RouteComparisonService(repository()).compare(input, 'user-1')).rejects.toMatchObject({ code: 'route_provider_not_configured' })
  })
})
