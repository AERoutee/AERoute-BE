import { randomUUID } from 'node:crypto'
import { getRouteAirQuality } from './providers/google-air-quality.provider.js'
import { getRoutes } from './providers/google-routes.provider.js'
import { getForecastWeather } from './providers/google-weather.provider.js'
import { rankRoutes } from './exposure.service.js'
import { evaluateWeatherAdvisory, type WeatherConditions } from './weather-advisory.service.js'
import type { RouteComparisonRepository } from './route-comparison.repository.js'
import type { RouteComparisonRequest } from './route-comparison.validation.js'

type Point = { latitude: number; longitude: number }

function decodePolyline(encoded: string): Point[] {
  const points: Point[] = []
  let index = 0, latitude = 0, longitude = 0
  while (index < encoded.length) {
    let result = 0, shift = 0, byte: number
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    latitude += result & 1 ? ~(result >> 1) : result >> 1
    result = 0; shift = 0
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    longitude += result & 1 ? ~(result >> 1) : result >> 1
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 })
  }
  return points
}

function routeWeatherLocations(encodedPolyline: string, fallback: Point[]) {
  const points = decodePolyline(encodedPolyline)
  if (points.length < 3) return fallback
  return [points[Math.floor((points.length - 1) * .25)], points[Math.floor((points.length - 1) * .5)], points[Math.floor((points.length - 1) * .75)]]
}

export class RouteComparisonService {
  constructor(private readonly repository: RouteComparisonRepository) {}

  async compare(input: RouteComparisonRequest, userId: string | null) {
    const providerRoutes = await getRoutes(input)
    const midpoint = { latitude: (input.origin.latitude + input.destination.latitude) / 2, longitude: (input.origin.longitude + input.destination.longitude) / 2 }
    const weatherProgress = [.25, .5, .75] as const
    const weatherLocationsByRoute = providerRoutes.map((route) => routeWeatherLocations(route.encodedPolyline, [input.origin, midpoint, input.destination]))
    const [candidates, sampledWeatherByRoute] = await Promise.all([
      Promise.all(providerRoutes.map(async (route) => {
        const airQuality = await getRouteAirQuality(route.encodedPolyline)
        return { ...route, averagePm25: airQuality.averagePm25, airQualityTimestamp: airQuality.timestamp, dataQuality: airQuality.dataQuality, airQualitySamples: airQuality.samples }
      })),
      Promise.all(weatherLocationsByRoute.map((locations, routeIndex) => Promise.all(
        locations.map((point, pointIndex) => getForecastWeather(point, providerRoutes[routeIndex].durationSeconds * weatherProgress[pointIndex]).catch((): WeatherConditions => ({ status: 'unavailable' }))),
      ))),
    ])
    const weather = sampledWeatherByRoute[0][1]
    const routes = rankRoutes(candidates, { preference: input.preference, sensitiveUser: input.sensitiveUser })
    const comparisonId = userId ? await this.repository.create({ userId, input, routes }) : randomUUID()
    const hasPartialEstimate = routes.some((route) => route.dataQuality === 'partial_estimate')
    const weatherAdvisory = evaluateWeatherAdvisory(weather, input.mode)

    return {
      comparisonId,
      routes,
      weather,
      weatherPoints: weatherLocationsByRoute[0].map((point, index) => ({ latitude: point.latitude, longitude: point.longitude, conditions: sampledWeatherByRoute[0][index] })),
      weatherPointsByRoute: Object.fromEntries(providerRoutes.map((route, routeIndex) => [route.id, weatherLocationsByRoute[routeIndex].map((point, pointIndex) => ({ latitude: point.latitude, longitude: point.longitude, conditions: sampledWeatherByRoute[routeIndex][pointIndex] }))])),
      weatherAdvisory,
      sourceDisclosure: { route: 'Google Routes API', airQuality: 'Google Air Quality API current conditions', weather: 'Google Weather API current conditions', customScore: true as const },
      warnings: [
        ...(hasPartialEstimate ? ['Some route samples were unavailable; this comparison uses partial air-quality coverage.'] : []),
      ],
    }
  }
}
