import { z } from 'zod'
import { env } from '../../../config/index.js'
import { AppError } from '../../../middleware/index.js'

const googleErrorSchema = z.object({
  error: z.object({
    status: z.string().optional(),
    details: z.array(z.object({ reason: z.string().optional() }).passthrough()).optional(),
  }),
})

const responseSchema = z.object({
  dateTime: z.string().datetime(),
  pollutants: z.array(z.object({
    code: z.string(),
    concentration: z.object({ value: z.number().nonnegative(), units: z.string() }),
  })),
})

type Point = { latitude: number; longitude: number }
type AirSample = { pm25: number; timestamp: string }

const cache = new Map<string, { expiresAt: number; value: AirSample }>()

function decodePolyline(encoded: string): Point[] {
  const points: Point[] = []
  let index = 0
  let latitude = 0
  let longitude = 0
  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte: number
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    latitude += result & 1 ? ~(result >> 1) : result >> 1
    result = 0
    shift = 0
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5 } while (byte >= 0x20)
    longitude += result & 1 ? ~(result >> 1) : result >> 1
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 })
  }
  return points
}

function samplePoints(points: Point[], count = 5) {
  if (points.length <= count) return points
  return Array.from({ length: count }, (_, index) => points[Math.round(index * (points.length - 1) / (count - 1))])
}

async function providerError(response: Response) {
  const parsed = googleErrorSchema.safeParse(await response.json().catch(() => null))
  const reason = parsed.success ? parsed.data.error.details?.find((detail) => detail.reason)?.reason : undefined
  if (reason === 'BILLING_DISABLED') return new AppError(503, 'air_quality_billing_required', 'Air-quality service billing is not enabled.', false)
  if (reason === 'API_KEY_SERVICE_BLOCKED' || reason === 'SERVICE_DISABLED') return new AppError(503, 'air_quality_service_blocked', 'Air-quality service is not enabled for this server key.', false)
  if (reason === 'API_KEY_INVALID' || reason === 'API_KEY_EXPIRED') return new AppError(503, 'air_quality_key_invalid', 'Air-quality service credentials are invalid.', false)
  return new AppError(response.status === 429 ? 503 : 502, 'air_quality_provider_error', 'Air-quality data is unavailable for this location.', response.status >= 500 || response.status === 429)
}

async function lookup(point: Point): Promise<AirSample> {
  const apiKey = env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) throw new AppError(503, 'air_quality_not_configured', 'Air-quality data is not configured.', false)
  const cacheKey = `${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const url = new URL('https://airquality.googleapis.com/v1/currentConditions:lookup')
  url.searchParams.set('key', apiKey)
  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: point, universalAqi: true, extraComputations: ['POLLUTANT_CONCENTRATION'], languageCode: 'en' }),
  })
  if (!response.ok) throw await providerError(response)
  const parsed = responseSchema.safeParse(await response.json())
  const pollutant = parsed.success ? parsed.data.pollutants.find((item) => item.code.toLowerCase() === 'pm25') : undefined
  if (!parsed.success || !pollutant || pollutant.concentration.units !== 'MICROGRAMS_PER_CUBIC_METER') throw new AppError(502, 'pm25_unavailable', 'PM2.5 data is unavailable for this route.', true)
  const value = { pm25: pollutant.concentration.value, timestamp: parsed.data.dateTime }
  if (cache.size >= 500) cache.delete(cache.keys().next().value ?? '')
  cache.set(cacheKey, { value, expiresAt: Date.now() + 10 * 60 * 1000 })
  return value
}

export async function getRouteAirQuality(encodedPolyline: string) {
  const points = samplePoints(decodePolyline(encodedPolyline))
  if (!points.length) throw new AppError(502, 'invalid_route_geometry', 'Route geometry could not be sampled.', true)
  const results = await Promise.allSettled(points.map(lookup))
  const configurationError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected' && result.reason instanceof AppError && !result.reason.retryable)
  if (configurationError) throw configurationError.reason
  const samples = results.flatMap((result, index) => result.status === 'fulfilled' ? [{ ...points[index], ...result.value }] : [])
  if (!samples.length) throw new AppError(503, 'air_quality_unavailable', 'Air-quality data is temporarily unavailable.', true)
  return {
    averagePm25: samples.reduce((total, sample) => total + sample.pm25, 0) / samples.length,
    timestamp: samples.map((sample) => sample.timestamp).sort().at(-1)!,
    dataQuality: samples.length === points.length ? 'modeled_estimate' as const : 'partial_estimate' as const,
    samples: samples.map(({ latitude, longitude, pm25 }) => ({ latitude, longitude, pm25 })),
  }
}
