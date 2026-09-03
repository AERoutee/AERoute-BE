jest.mock('../src/config/index.js', () => ({ auth: { api: { getSession: jest.fn() } } }))
jest.mock('../src/modules/route-comparison/providers/google-routes.provider.js', () => ({ getRoutes: jest.fn() }))
jest.mock('../src/modules/route-comparison/providers/google-air-quality.provider.js', () => ({ getRouteAirQuality: jest.fn() }))
jest.mock('../src/modules/route-comparison/providers/google-weather.provider.js', () => ({ getForecastWeather: jest.fn() }))
jest.mock('../src/modules/route-comparison/providers/google-places.provider.js', () => ({ getPlacePhoto: jest.fn(), getRestStopCandidates: jest.fn(), getTransitStopDetails: jest.fn() }))

import { auth } from '../src/config/index'
import { AppError } from '../src/middleware/errors'
import { getRouteAirQuality } from '../src/modules/route-comparison/providers/google-air-quality.provider'
import { getPlacePhoto, getRestStopCandidates, getTransitStopDetails } from '../src/modules/route-comparison/providers/google-places.provider'
import { getRoutes } from '../src/modules/route-comparison/providers/google-routes.provider'
import { getForecastWeather } from '../src/modules/route-comparison/providers/google-weather.provider'
import { RouteComparisonController } from '../src/modules/route-comparison/route-comparison.controller'
import type { RouteComparisonRepository } from '../src/modules/route-comparison/route-comparison.repository'
import { RouteComparisonService } from '../src/modules/route-comparison/route-comparison.service'
import { request, response, next } from './helpers'

const getSession = jest.mocked(auth.api.getSession)
const routesMock = jest.mocked(getRoutes)
const airQualityMock = jest.mocked(getRouteAirQuality)
const weatherMock = jest.mocked(getForecastWeather)
const photoMock = jest.mocked(getPlacePhoto)
const placesMock = jest.mocked(getRestStopCandidates)
const transitStopDetailsMock = jest.mocked(getTransitStopDetails)
const baseInput = {
  origin: { latitude: 38.5, longitude: -120.2 }, destination: { latitude: 43.252, longitude: -126.453 },
  mode: 'WALK' as const, preference: 'balanced' as const, sensitiveUser: false,
  accessibilityMode: 'STANDARD' as const, departureOffsetsMinutes: [0] as Array<0 | 30 | 60>, hazardPolicy: 'PREFER_FEWER_REPORTS' as const, includeRestStops: true,
}
const weather = {
  status: 'available' as const, observedAt: '2026-08-30T10:00:00.000Z', targetTime: '2026-08-30T10:05:00.000Z', forecastOffsetMinutes: 5, conditionType: 'CLEAR', condition: 'Clear', isDaytime: true,
  temperatureC: 28, feelsLikeC: 30, heatIndexC: 30, humidityPercent: 70, uvIndex: 4, precipitationProbabilityPercent: 10, thunderstormProbabilityPercent: 5, windSpeedKph: 10, windGustKph: 15, visibilityKm: 10,
}

function repository() {
  return { create: jest.fn().mockResolvedValue({ comparisonId: 'comparison-1', routeResultIds: { route_1: '11111111-1111-4111-8111-111111111111', route_2: '22222222-2222-4222-8222-222222222222' } }), savePlaceAssociations: jest.fn().mockResolvedValue([]) } as unknown as jest.Mocked<RouteComparisonRepository>
}

function roadReports() {
  return { findActiveInBounds: jest.fn().mockResolvedValue([]) }
}

function providerRoute(id: string) {
  return { id, durationSeconds: 600, distanceMeters: 1000, encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', providerLabels: ['DEFAULT_ROUTE'] }
}

function airQuality(pm25: number, sampleCount = 5) {
  return { averagePm25: pm25, timestamp: '2026-08-30T10:00:00.000Z', dataQuality: sampleCount === 5 ? 'modeled_estimate' as const : 'partial_estimate' as const, sampleCount, expectedSampleCount: 5, samples: [{ latitude: 38.5, longitude: -120.2, pm25 }], temporalResolution: 'CURRENT_CONDITIONS' as const, approximate: false }
}

describe('route comparison service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    routesMock.mockResolvedValue([providerRoute('route_1')])
    airQualityMock.mockResolvedValue(airQuality(12))
    weatherMock.mockResolvedValue(weather)
    placesMock.mockResolvedValue({ status: 'AVAILABLE', candidates: [] })
  })

  it('combines route intelligence, queries bounded reports, persists current routes, and requests rest candidates once', async () => {
    const repo = repository()
    repo.create.mockResolvedValue({ comparisonId: 'comparison-1', routeResultIds: { route_1: '11111111-1111-4111-8111-111111111111' } })
    const reports = roadReports()
    const result = await new RouteComparisonService(repo, reports as never).compare(baseInput, 'user-1')
    expect(reports.findActiveInBounds).toHaveBeenCalledWith(expect.objectContaining({ north: expect.any(Number), south: expect.any(Number) }), expect.any(Date))
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', calculationVersion: 'route-intelligence-v2', routes: [expect.objectContaining({ confidence: expect.objectContaining({ kind: 'EVIDENCE_COMPLETENESS', isProbability: false }), hazardSummary: expect.objectContaining({ level: 'NONE_REPORTED' }) })] }))
    expect(placesMock).toHaveBeenCalledTimes(1)
    expect(transitStopDetailsMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({ comparisonId: 'comparison-1', persisted: true, calculationVersion: 'route-intelligence-v2', weatherAdvisory: { level: 'NORMAL' }, cleanestDeparture: 0 })
    expect(result.routes[0]).toMatchObject({ id: 'route_1', routeResultId: '11111111-1111-4111-8111-111111111111' })
    expect(result.routes[0].explanation.ruleVersion).toBe('route-ranking-v2')
    expect(result.weatherPoints).toHaveLength(5)
  })

  it('persists rest-stop Place IDs against the recommended route by ordinal and maps association IDs', async () => {
    const repo = repository()
    repo.savePlaceAssociations.mockResolvedValue([{ id: 'association-1', ordinal: 0 }, { id: 'association-2', ordinal: 1 }])
    placesMock.mockResolvedValue({ status: 'AVAILABLE', candidates: [
      { id: 'place-1', name: 'One', location: { latitude: 1, longitude: 2 }, types: ['cafe'], safetyVerified: false },
      { id: 'place-2', name: 'Two', location: { latitude: 3, longitude: 4 }, types: ['park'], safetyVerified: false },
    ] })
    const result = await new RouteComparisonService(repo, roadReports() as never).compare(baseInput, 'user-1')
    expect(repo.savePlaceAssociations).toHaveBeenCalledWith('user-1', '11111111-1111-4111-8111-111111111111', 'REST_STOP', [{ placeId: 'place-1', ordinal: 0 }, { placeId: 'place-2', ordinal: 1 }])
    expect(result.restStopCandidates).toMatchObject({ status: 'AVAILABLE', candidates: [{ associationId: 'association-1' }, { associationId: 'association-2' }] })
    expect(JSON.stringify(repo.savePlaceAssociations.mock.calls[0])).not.toMatch(/One|Two|latitude|longitude|cafe|park/)
  })

  it('matches active reports within 100 meters and reports fewer confirmed report signals without safety claims', async () => {
    const reports = roadReports()
    reports.findActiveInBounds.mockResolvedValue([{
      id: 'report-1', userId: 'user-1', category: 'BLOCKED_PATH', description: 'Blocked', latitude: 38.5005, longitude: -120.2,
      createdAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), resolvedAt: null, images: [{ id: 'image-1' }], user: null, verifications: [{ userId: 'u2', verdict: 'CONFIRM' }, { userId: 'u3', verdict: 'CONFIRM' }],
    }])
    const result = await new RouteComparisonService(repository(), reports as never).compare({ ...baseInput, includeRestStops: false }, 'user-1')
    expect(result).toMatchObject({ persisted: true })
    expect(result.routes[0].hazardSummary).toMatchObject({ level: 'HIGH', nearbyCount: 1, confirmedCount: 1, confirmedReportSignalScore: 18, fewerConfirmedReportSignals: 0 })
    expect(JSON.stringify(result.routes[0])).not.toMatch(/hazard-free|safe route/i)
    expect(placesMock).not.toHaveBeenCalled()
  })

  it('passes the provider transit itinerary through the public route response', async () => {
    const transitSummary = {
      walkingDurationSeconds: 420,
      walkingDistanceMeters: 550,
      transfers: 0,
      segments: [
        { travelMode: 'WALK', durationSeconds: 300, distanceMeters: 400 },
        { travelMode: 'TRANSIT', durationSeconds: 900, distanceMeters: 4200, vehicleType: 'BUS', departureStop: { name: 'Central' }, arrivalStop: { name: 'Park' } },
        { travelMode: 'WALK', durationSeconds: 120, distanceMeters: 150 },
      ],
      stations: [{ name: 'Central' }, { name: 'Park' }],
    }
    routesMock.mockResolvedValue([{ ...providerRoute('route_1'), transitSummary }])
    const result = await new RouteComparisonService(repository(), roadReports() as never).compare({ ...baseInput, mode: 'TRANSIT' }, 'user-1')
    expect(result.routes[0].transitSummary).toEqual(transitSummary)
  })

  it('prevents weak partial sampling from uniquely winning when a strong route exists', async () => {
    routesMock.mockResolvedValue([providerRoute('route_1'), { ...providerRoute('route_2'), durationSeconds: 620 }])
    airQualityMock.mockResolvedValueOnce(airQuality(20)).mockResolvedValueOnce(airQuality(1, 2))
    const result = await new RouteComparisonService(repository(), roadReports() as never).compare({ ...baseInput, preference: 'lower-exposure' }, 'user-1')
    expect(result.routes.find((route) => route.labels.includes('RECOMMENDED'))?.id).toBe('route_1')
  })

  it('chooses cleanest departure from every route even when it diverges from the recommended route', async () => {
    routesMock.mockResolvedValue([providerRoute('route_1'), { ...providerRoute('route_2'), durationSeconds: 800 }])
    airQualityMock
      .mockResolvedValueOnce(airQuality(1))
      .mockResolvedValueOnce(airQuality(1))
      .mockResolvedValueOnce(airQuality(5))
      .mockResolvedValueOnce(airQuality(0.1))
    const result = await new RouteComparisonService(repository(), roadReports() as never).compare({ ...baseInput, departureOffsetsMinutes: [0, 30] }, 'user-1')
    expect(result.departureComparisons.find((window) => window.offsetMinutes === 0)?.recommendedRouteId).toBe('route_1')
    expect(result.departureComparisons.find((window) => window.offsetMinutes === 30)?.recommendedRouteId).toBe('route_1')
    expect(result.cleanestDeparture).toBe(30)
  })

  it('degrades rest-stop provider status and future AQ windows without failing current routes', async () => {
    airQualityMock.mockResolvedValueOnce(airQuality(12)).mockRejectedValueOnce(new AppError(503, 'air_quality_unavailable', 'down', true))
    placesMock.mockResolvedValue({ status: 'UNAVAILABLE', candidates: [], warning: 'Rest-stop candidates are temporarily unavailable.' })
    const result = await new RouteComparisonService(repository(), roadReports() as never).compare({ ...baseInput, departureOffsetsMinutes: [0, 30] }, 'user-1')
    expect(result.departureComparisons).toEqual(expect.arrayContaining([expect.objectContaining({ offsetMinutes: 30, status: 'UNAVAILABLE', approximate: true, temporalResolution: 'HOURLY_BUCKET' })]))
    expect(result.restStopCandidates.status).toBe('UNAVAILABLE')
    expect(result.warnings).toContain('Rest-stop candidates are temporarily unavailable.')
  })

  it('degrades retryable future transit route failures and surfaces permanent future AQ configuration warnings', async () => {
    routesMock.mockResolvedValueOnce([providerRoute('route_1')]).mockRejectedValueOnce(new AppError(503, 'route_provider_unavailable', 'down', true))
    let call = 0
    airQualityMock.mockImplementation(async () => {
      call += 1
      if (call === 2) throw new AppError(503, 'air_quality_service_blocked', 'blocked', false)
      return airQuality(12)
    })
    const transitInput = { ...baseInput, mode: 'TRANSIT' as const, departureOffsetsMinutes: [0, 30, 60] as Array<0 | 30 | 60>, accessibilityMode: 'REDUCED_EXERTION' as const }
    const result = await new RouteComparisonService(repository(), roadReports() as never).compare(transitInput, 'user-1')
    expect(result.departureComparisons).toEqual(expect.arrayContaining([
      expect.objectContaining({ offsetMinutes: 30, status: 'UNAVAILABLE', warning: expect.stringContaining('Routes are unavailable') }),
      expect.objectContaining({ offsetMinutes: 60, status: 'UNAVAILABLE', warning: expect.stringContaining('configuration error') }),
    ]))
    expect(result.warnings).toContain('Reduced exertion is an approximation and does not verify wheelchair access or step-free travel.')
  })

  it('rejects malformed provider geometry', async () => {
    routesMock.mockResolvedValue([{ ...providerRoute('bad'), encodedPolyline: '?' }])
    await expect(new RouteComparisonService(repository()).compare(baseInput, 'user-1')).rejects.toMatchObject({ code: 'invalid_route_geometry' })
  })

  it('rejects required step-free routing honestly', async () => {
    await expect(new RouteComparisonService(repository()).compare({ ...baseInput, accessibilityMode: 'STEP_FREE_REQUIRED' }, 'user-1')).rejects.toMatchObject({ statusCode: 422, code: 'accessibility_routing_unsupported' })
    expect(routesMock).not.toHaveBeenCalled()
  })

  it('delegates opaque photo names to the provider', async () => {
    const image = { body: Buffer.from([1]), contentType: 'image/jpeg' }
    photoMock.mockResolvedValue(image)
    await expect(new RouteComparisonService(repository()).photo('places/place_1/photos/photo_1')).resolves.toBe(image)
    expect(photoMock).toHaveBeenCalledWith('places/place_1/photos/photo_1')
  })
})

describe('route comparison controller and validation', () => {
  beforeEach(() => jest.clearAllMocks())

  it('applies backend defaults independently of frontend behavior', async () => {
    const result = { comparisonId: 'comparison-1', routes: [{ id: 'route-1' }] }
    const service = { compare: jest.fn().mockResolvedValue(result) }
    const submitted = { origin: baseInput.origin, destination: baseInput.destination, mode: 'TRANSIT', preference: 'balanced', accessibilityMode: 'REDUCED_EXERTION' }
    await new RouteComparisonController(service as never).compare(request({ body: submitted }), response({ userId: 'user-1' }), next())
    expect(service.compare).toHaveBeenCalledWith(expect.objectContaining({ mode: 'TRANSIT', accessibilityMode: 'REDUCED_EXERTION', transitPreference: 'LESS_WALKING', departureOffsetsMinutes: [0, 30, 60], hazardPolicy: 'PREFER_FEWER_REPORTS', includeRestStops: true }), 'user-1')
  })

  it('serves photo bytes with private non-sniffable headers', async () => {
    const image = { body: Buffer.from([1, 2, 3]), contentType: 'image/png' }
    const service = { compare: jest.fn(), photo: jest.fn().mockResolvedValue(image) }
    const res = response({ userId: 'user-1' })
    await new RouteComparisonController(service as never).photo(request({ query: { name: 'places/place_1/photos/photo_1' } }), res, next())
    expect(service.photo).toHaveBeenCalledWith('places/place_1/photos/photo_1')
    expect(res.set).toHaveBeenCalledWith({ 'Content-Type': 'image/png', 'Content-Length': '3', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' })
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.send).toHaveBeenCalledWith(image.body)
  })

  it('limits each authenticated user to ten comparisons per five-minute window', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T12:00:00.000Z'))
    const service = { compare: jest.fn().mockResolvedValue({ comparisonId: 'comparison-1', routes: [{ id: 'route-1' }] }) }
    const controller = new RouteComparisonController(service as never)
    for (let count = 0; count < 10; count += 1) await controller.compare(request({ body: baseInput }), response({ userId: 'user-1' }), next())
    await expect(controller.compare(request({ body: baseInput }), response({ userId: 'user-1' }), next())).rejects.toMatchObject({ statusCode: 429, code: 'route_comparison_rate_limited', retryable: false })
    await expect(controller.compare(request({ body: baseInput }), response({ userId: 'user-2' }), next())).resolves.toBeUndefined()
    jest.advanceTimersByTime(300_000)
    await expect(controller.compare(request({ body: baseInput }), response({ userId: 'user-1' }), next())).resolves.toBeUndefined()
    jest.useRealTimers()
  })

  it('limits photos to sixty per user independently from comparisons and resets at five minutes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T12:00:00.000Z'))
    const service = { compare: jest.fn().mockResolvedValue({ comparisonId: 'comparison-1', routes: [{ id: 'route-1' }] }), photo: jest.fn().mockResolvedValue({ body: Buffer.from([1]), contentType: 'image/jpeg' }) }
    const controller = new RouteComparisonController(service as never)
    await controller.compare(request({ body: baseInput }), response({ userId: 'user-1' }), next())
    for (let count = 0; count < 60; count += 1) await controller.photo(request({ query: { name: 'places/place_1/photos/photo_1' } }), response({ userId: 'user-1' }), next())
    await expect(controller.photo(request({ query: { name: 'places/place_1/photos/photo_1' } }), response({ userId: 'user-1' }), next())).rejects.toMatchObject({ statusCode: 429, code: 'place_photo_rate_limited', retryable: false })
    await expect(controller.photo(request({ query: { name: 'places/place_1/photos/photo_1' } }), response({ userId: 'user-2' }), next())).resolves.toBeUndefined()
    jest.advanceTimersByTime(300_000)
    await expect(controller.photo(request({ query: { name: 'places/place_1/photos/photo_1' } }), response({ userId: 'user-1' }), next())).resolves.toBeUndefined()
    expect(service.compare).toHaveBeenCalledTimes(1)
    jest.useRealTimers()
  })

  it.each([
    { ...baseInput, mode: 'CAR' },
    { ...baseInput, departureOffsetsMinutes: [0, 0] },
    { ...baseInput, departureOffsetsMinutes: [15] },
    { ...baseInput, transitModes: ['BUS', 'BUS'] },
    { ...baseInput, transitModes: ['BUS'] },
    { ...baseInput, transitPreference: 'LESS_WALKING' },
    { ...baseInput, destination: baseInput.origin },
  ])('rejects invalid request bodies before auth/service access', async (body) => {
    const service = { compare: jest.fn() }
    await expect(new RouteComparisonController(service as never).compare(request({ body }), response(), next())).rejects.toThrow()
    expect(getSession).not.toHaveBeenCalled()
  })
})
