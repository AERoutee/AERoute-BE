jest.mock('../src/config/index.js', () => ({
  auth: { api: { getSession: jest.fn() } },
}))
jest.mock('../src/modules/route-comparison/providers/google-routes.provider.js', () => ({ getRoutes: jest.fn() }))
jest.mock('../src/modules/route-comparison/providers/google-air-quality.provider.js', () => ({ getRouteAirQuality: jest.fn() }))
jest.mock('../src/modules/route-comparison/providers/google-weather.provider.js', () => ({ getForecastWeather: jest.fn() }))

import { auth } from '../src/config/index'
import { RouteComparisonController } from '../src/modules/route-comparison/route-comparison.controller'
import type { RouteComparisonRepository } from '../src/modules/route-comparison/route-comparison.repository'
import { RouteComparisonService } from '../src/modules/route-comparison/route-comparison.service'
import { getRouteAirQuality } from '../src/modules/route-comparison/providers/google-air-quality.provider'
import { getRoutes } from '../src/modules/route-comparison/providers/google-routes.provider'
import { getForecastWeather } from '../src/modules/route-comparison/providers/google-weather.provider'
import { request, response, next } from './helpers'

const getSession = jest.mocked(auth.api.getSession)
const routesMock = jest.mocked(getRoutes)
const airQualityMock = jest.mocked(getRouteAirQuality)
const weatherMock = jest.mocked(getForecastWeather)
const baseInput = {
  origin: { latitude: -6.2, longitude: 106.8 }, destination: { latitude: -6.21, longitude: 106.81 },
  mode: 'WALK' as const, preference: 'balanced' as const, sensitiveUser: false,
}
const weather = {
  status: 'available' as const, observedAt: '2026-08-30T10:00:00.000Z', forecastOffsetMinutes: 5, conditionType: 'CLEAR', condition: 'Clear', isDaytime: true,
  temperatureC: 28, feelsLikeC: 30, heatIndexC: 30, humidityPercent: 70, uvIndex: 4, precipitationProbabilityPercent: 10, thunderstormProbabilityPercent: 5, windSpeedKph: 10, windGustKph: 15, visibilityKm: 10,
}

function repository() {
  return { create: jest.fn() } as unknown as jest.Mocked<RouteComparisonRepository>
}

function providerRoute(id: string, encodedPolyline = '_ibE_seK_seK') {
  return { id, durationSeconds: 600, distanceMeters: 1000, encodedPolyline }
}

function airQuality(pm25: number, dataQuality: 'modeled_estimate' | 'partial_estimate' = 'modeled_estimate') {
  return { averagePm25: pm25, timestamp: '2026-08-30T10:00:00.000Z', dataQuality, samples: [{ latitude: -6.2, longitude: 106.8, pm25 }] }
}

describe('route comparison service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    routesMock.mockResolvedValue([providerRoute('route_1')])
    airQualityMock.mockResolvedValue(airQuality(12))
    weatherMock.mockResolvedValue(weather)
  })

  it('combines providers, ranks routes, samples weather, and persists for authenticated users', async () => {
    const repo = repository()
    repo.create.mockResolvedValue('comparison-1')
    const result = await new RouteComparisonService(repo).compare(baseInput, 'user-1')
    expect(repo.create).toHaveBeenCalledWith({ userId: 'user-1', input: baseInput, routes: expect.arrayContaining([expect.objectContaining({ id: 'route_1', labels: expect.arrayContaining(['FASTEST', 'RECOMMENDED', 'LOWEST_EXPOSURE']) })]) })
    expect(result).toMatchObject({ comparisonId: 'comparison-1', weather, weatherAdvisory: { level: 'NORMAL' }, warnings: [] })
    expect(result.weatherPoints).toHaveLength(3)
    expect(result.weatherPointsByRoute.route_1).toHaveLength(3)
    expect(weatherMock).toHaveBeenCalledTimes(3)
  })

  it('uses an ephemeral comparison and fallback origin/midpoint/destination weather locations for short geometry', async () => {
    const repo = repository()
    const result = await new RouteComparisonService(repo).compare(baseInput, null)
    expect(repo.create).not.toHaveBeenCalled()
    expect(result.comparisonId).toEqual(expect.any(String))
    expect(weatherMock.mock.calls.map(([point]) => point)).toEqual([baseInput.origin, { latitude: -6.205, longitude: 106.805 }, baseInput.destination])
  })

  it('samples decoded polyline checkpoints and degrades individual weather failures', async () => {
    const encodedFivePoints = '_ibE_seK_seK_seK_seK_seK_seK_seK_seK_seK'
    routesMock.mockResolvedValue([providerRoute('route_1', encodedFivePoints)])
    weatherMock.mockResolvedValueOnce(weather).mockRejectedValueOnce(new Error('weather down')).mockResolvedValueOnce({ status: 'unavailable' })
    airQualityMock.mockResolvedValue(airQuality(20, 'partial_estimate'))
    const result = await new RouteComparisonService(repository()).compare(baseInput, null)
    expect(result.weather).toEqual({ status: 'unavailable' })
    expect(result.weatherPoints[1].conditions).toEqual({ status: 'unavailable' })
    expect(result.warnings).toEqual(['Some route samples were unavailable; this comparison uses partial air-quality coverage.'])
    expect(result.weatherAdvisory.level).toBe('UNAVAILABLE')
  })

  it('handles multiple routes independently and uses first route weather for advisory', async () => {
    routesMock.mockResolvedValue([providerRoute('route_1'), providerRoute('route_2')])
    airQualityMock.mockResolvedValueOnce(airQuality(10)).mockResolvedValueOnce(airQuality(5))
    weatherMock
      .mockResolvedValueOnce(weather)
      .mockResolvedValueOnce({ ...weather, precipitationProbabilityPercent: 80 })
      .mockResolvedValue(weather)
    const result = await new RouteComparisonService(repository()).compare({ ...baseInput, preference: 'lower-exposure' }, null)
    expect(result.weatherAdvisory.level).toBe('CAUTION')
    expect(Object.keys(result.weatherPointsByRoute)).toEqual(['route_1', 'route_2'])
    expect(result.routes.find((route) => route.id === 'route_2')?.labels).toContain('LOWEST_EXPOSURE')
  })

  it('propagates route and air-quality provider failures', async () => {
    routesMock.mockRejectedValueOnce(new Error('routes'))
    await expect(new RouteComparisonService(repository()).compare(baseInput, null)).rejects.toThrow('routes')
    routesMock.mockResolvedValue([providerRoute('route_1')])
    airQualityMock.mockRejectedValueOnce(new Error('air'))
    await expect(new RouteComparisonService(repository()).compare(baseInput, null)).rejects.toThrow('air')
  })
})

describe('route comparison controller and validation', () => {
  beforeEach(() => jest.clearAllMocks())

  it('accepts an anonymous comparison and returns route count stats', async () => {
    getSession.mockResolvedValue(null as never)
    const result = { comparisonId: 'comparison-1', routes: [{ id: 'route-1' }] }
    const service = { compare: jest.fn().mockResolvedValue(result) }
    const res = response()
    await new RouteComparisonController(service as never).compare(request({ body: baseInput, headers: { cookie: 'x' } }), res, next())
    expect(service.compare).toHaveBeenCalledWith(baseInput, null)
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ data: result, stats: { routeCount: 1 } })
  })

  it('passes an authenticated user to the service', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    const result = { routes: [{ id: 'one' }, { id: 'two' }] }
    const service = { compare: jest.fn().mockResolvedValue(result) }
    await new RouteComparisonController(service as never).compare(request({ body: baseInput }), response(), next())
    expect(service.compare).toHaveBeenCalledWith(baseInput, 'user-1')
  })

  it.each([
    { ...baseInput, mode: 'CAR' },
    { ...baseInput, origin: { ...baseInput.origin, latitude: 91 } },
    { ...baseInput, sensitiveUser: 'true' },
    { ...baseInput, destination: baseInput.origin },
  ])('rejects invalid request bodies before auth/service access', async (body) => {
    const service = { compare: jest.fn() }
    await expect(new RouteComparisonController(service as never).compare(request({ body }), response(), next())).rejects.toThrow()
    expect(getSession).not.toHaveBeenCalled()
    expect(service.compare).not.toHaveBeenCalled()
  })

  it('propagates auth and service failures', async () => {
    const authFailure = new Error('session')
    getSession.mockRejectedValue(authFailure)
    await expect(new RouteComparisonController({ compare: jest.fn() } as never).compare(request({ body: baseInput }), response(), next())).rejects.toBe(authFailure)
    getSession.mockResolvedValue(null as never)
    const serviceFailure = new Error('comparison')
    await expect(new RouteComparisonController({ compare: jest.fn().mockRejectedValue(serviceFailure) } as never).compare(request({ body: baseInput }), response(), next())).rejects.toBe(serviceFailure)
  })
})
