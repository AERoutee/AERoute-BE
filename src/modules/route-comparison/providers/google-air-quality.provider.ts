import { z } from 'zod'
import { env } from '../../../config/index.js'
import { AppError } from '../../../middleware/index.js'
import { decodePolyline, samplePolyline, type GeoPoint } from '../../../utils/index.js'

const googleErrorSchema = z.object({
  error: z.object({
    status: z.string().optional(),
    details: z.array(z.object({ reason: z.string().optional() }).passthrough()).optional(),
  }),
})
const pollutantSchema = z.array(z.object({
  code: z.string(),
  concentration: z.object({ value: z.number().nonnegative(), units: z.string() }),
}))
const currentResponseSchema = z.object({ dateTime: z.string().datetime(), pollutants: pollutantSchema })
const forecastResponseSchema = z.object({ hourlyForecasts: z.array(z.object({ dateTime: z.string().datetime(), pollutants: pollutantSchema })).min(1) })

type AirSample = { pm25: number; timestamp: string }
const cache = new Map<string, { expiresAt: number; value: AirSample }>()
const inFlight = new Map<string, Promise<AirSample>>()

async function providerError(response: Response) {
  const parsed = googleErrorSchema.safeParse(await response.json().catch(() => null))
  const reason = parsed.success ? parsed.data.error.details?.find((detail) => detail.reason)?.reason : undefined
  if (reason === 'BILLING_DISABLED') return new AppError(503, 'air_quality_billing_required', 'Air-quality service billing is not enabled.', false)
  if (reason === 'API_KEY_SERVICE_BLOCKED' || reason === 'SERVICE_DISABLED') return new AppError(503, 'air_quality_service_blocked', 'Air-quality service is not enabled for this server key.', false)
  if (reason === 'API_KEY_INVALID' || reason === 'API_KEY_EXPIRED') return new AppError(503, 'air_quality_key_invalid', 'Air-quality service credentials are invalid.', false)
  return new AppError(response.status === 429 ? 503 : 502, 'air_quality_provider_error', 'Air-quality data is unavailable for this location.', response.status >= 500 || response.status === 429)
}

function sampleFrom(pollutants: z.infer<typeof pollutantSchema>, timestamp: string) {
  const pollutant = pollutants.find((item) => item.code.toLowerCase() === 'pm25')
  if (!pollutant || pollutant.concentration.units !== 'MICROGRAMS_PER_CUBIC_METER') throw new AppError(502, 'pm25_unavailable', 'PM2.5 data is unavailable for this route.', true)
  return { pm25: pollutant.concentration.value, timestamp }
}

async function lookup(point: GeoPoint, target: Date, now: Date, forecast: boolean): Promise<AirSample> {
  const apiKey = env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) throw new AppError(503, 'air_quality_not_configured', 'Air-quality data is not configured.', false)
  const bucket = forecast ? Math.floor(target.getTime() / 3_600_000) : `current:${Math.floor(now.getTime() / 3_600_000)}`
  const cacheKey = `${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}:${bucket}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const pending = inFlight.get(cacheKey)
  if (pending) return pending
  const request = (async () => {
    const url = new URL(forecast ? 'https://airquality.googleapis.com/v1/forecast:lookup' : 'https://airquality.googleapis.com/v1/currentConditions:lookup')
    url.searchParams.set('key', apiKey)
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: point, universalAqi: true, extraComputations: ['POLLUTANT_CONCENTRATION'], languageCode: 'en', ...(forecast ? { dateTime: target.toISOString() } : {}) }),
    }).catch(() => { throw new AppError(503, 'air_quality_provider_unavailable', 'Air-quality data is temporarily unavailable.', true) })
    if (!response.ok) throw await providerError(response)
    const payload: unknown = await response.json().catch(() => null)
    const current = forecast ? null : currentResponseSchema.safeParse(payload)
    const future = forecast ? forecastResponseSchema.safeParse(payload) : null
    const value = current?.success ? sampleFrom(current.data.pollutants, current.data.dateTime) : future?.success ? sampleFrom(future.data.hourlyForecasts[0].pollutants, future.data.hourlyForecasts[0].dateTime) : null
    if (!value) throw new AppError(502, 'invalid_air_quality_response', 'Air-quality service returned an invalid response.', true)
    if (cache.size >= 500) cache.delete(cache.keys().next().value ?? '')
    cache.set(cacheKey, { value, expiresAt: Date.now() + 10 * 60 * 1000 })
    return value
  })()
  inFlight.set(cacheKey, request)
  try { return await request } finally { if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey) }
}

export async function getRouteAirQuality(encodedPolyline: string, departureTime = new Date(), durationSeconds = 0, now = new Date()) {
  let points: GeoPoint[]
  try {
    points = samplePolyline(decodePolyline(encodedPolyline), 5)
  } catch {
    throw new AppError(502, 'invalid_route_geometry', 'Route geometry could not be sampled.', true)
  }
  if (!points.length) throw new AppError(502, 'invalid_route_geometry', 'Route geometry could not be sampled.', true)
  const forecast = departureTime.getTime() > now.getTime()
  const results = await Promise.allSettled(points.map(async (point, index) => ({ ...point, ...await lookup(point, new Date(departureTime.getTime() + durationSeconds * (points.length === 1 ? 0 : index / (points.length - 1)) * 1000), now, forecast) })))
  const providerErrors = results.flatMap((result) => result.status === 'rejected' && result.reason instanceof AppError ? [result.reason] : [])
  const permanentError = providerErrors.find((error) => !error.retryable)
  if (permanentError) throw permanentError
  const samples = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
  if (!samples.length) throw providerErrors[0] ?? new AppError(503, 'air_quality_unavailable', 'Air-quality data is temporarily unavailable.', true)
  return {
    averagePm25: samples.reduce((total, sample) => total + sample.pm25, 0) / samples.length,
    timestamp: samples.map((sample) => sample.timestamp).sort().at(-1)!,
    dataQuality: samples.length === points.length ? 'modeled_estimate' as const : 'partial_estimate' as const,
    sampleCount: samples.length,
    expectedSampleCount: points.length,
    samples: samples.map(({ latitude, longitude, pm25 }) => ({ latitude, longitude, pm25 })),
    temporalResolution: forecast ? 'HOURLY_BUCKET' as const : 'CURRENT_CONDITIONS' as const,
    approximate: forecast,
  }
}
