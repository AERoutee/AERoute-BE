import { z } from 'zod'
import { env } from '../../../config/index.js'
import { AppError } from '../../../middleware/index.js'
import type { WeatherConditions } from '../weather-advisory.service.js'

const measureSchema = z.object({ degrees: z.number(), unit: z.literal('CELSIUS') })
const speedSchema = z.object({ value: z.number().nonnegative(), unit: z.literal('KILOMETERS_PER_HOUR') })
const responseSchema = z.object({
  currentTime: z.string().datetime(),
  isDaytime: z.boolean(),
  weatherCondition: z.object({ type: z.string(), description: z.object({ text: z.string() }) }),
  temperature: measureSchema,
  feelsLikeTemperature: measureSchema,
  heatIndex: measureSchema,
  relativeHumidity: z.number().int().min(0).max(100),
  uvIndex: z.number().int().nonnegative(),
  precipitation: z.object({ probability: z.object({ percent: z.number().int().min(0).max(100) }) }),
  thunderstormProbability: z.number().int().min(0).max(100),
  wind: z.object({ speed: speedSchema, gust: speedSchema }),
  visibility: z.object({ distance: z.number().nonnegative(), unit: z.literal('KILOMETERS') }),
})
const googleErrorSchema = z.object({ error: z.object({ details: z.array(z.object({ reason: z.string().optional() }).passthrough()).optional() }) })
const cache = new Map<string, { expiresAt: number; value: WeatherConditions }>()

type Point = { latitude: number; longitude: number }

async function providerError(response: Response) {
  const parsed = googleErrorSchema.safeParse(await response.json().catch(() => null))
  const reason = parsed.success ? parsed.data.error.details?.find((detail) => detail.reason)?.reason : undefined
  if (reason === 'BILLING_DISABLED') return new AppError(503, 'weather_billing_required', 'Weather service billing is not enabled.', false)
  if (reason === 'API_KEY_SERVICE_BLOCKED' || reason === 'SERVICE_DISABLED') return new AppError(503, 'weather_service_blocked', 'Weather API is not enabled for this server key.', false)
  if (reason === 'API_KEY_INVALID' || reason === 'API_KEY_EXPIRED') return new AppError(503, 'weather_key_invalid', 'Weather service credentials are invalid.', false)
  return new AppError(response.status === 429 ? 503 : 502, 'weather_provider_error', 'Current weather conditions are unavailable.', response.status >= 500 || response.status === 429)
}

export async function getCurrentWeather(point: Point): Promise<WeatherConditions> {
  const apiKey = env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) throw new AppError(503, 'weather_not_configured', 'Weather data is not configured.', false)
  const cacheKey = `${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const url = new URL('https://weather.googleapis.com/v1/currentConditions:lookup')
  url.searchParams.set('key', apiKey)
  url.searchParams.set('location.latitude', String(point.latitude))
  url.searchParams.set('location.longitude', String(point.longitude))
  url.searchParams.set('unitsSystem', 'METRIC')
  url.searchParams.set('languageCode', 'en')
  const response = await fetch(url, { signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS) }).catch(() => { throw new AppError(503, 'weather_provider_unavailable', 'Current weather conditions are unavailable.', true) })
  if (!response.ok) throw await providerError(response)
  const parsed = responseSchema.safeParse(await response.json())
  if (!parsed.success) throw new AppError(502, 'invalid_weather_response', 'Weather service returned an invalid response.', true)
  const data = parsed.data
  const value: WeatherConditions = {
    status: 'available',
    observedAt: data.currentTime,
    conditionType: data.weatherCondition.type,
    condition: data.weatherCondition.description.text,
    isDaytime: data.isDaytime,
    temperatureC: data.temperature.degrees,
    feelsLikeC: data.feelsLikeTemperature.degrees,
    heatIndexC: data.heatIndex.degrees,
    humidityPercent: data.relativeHumidity,
    uvIndex: data.uvIndex,
    precipitationProbabilityPercent: data.precipitation.probability.percent,
    thunderstormProbabilityPercent: data.thunderstormProbability,
    windSpeedKph: data.wind.speed.value,
    windGustKph: data.wind.gust.value,
    visibilityKm: data.visibility.distance,
  }
  if (cache.size >= 500) cache.delete(cache.keys().next().value ?? '')
  cache.set(cacheKey, { value, expiresAt: Date.now() + 10 * 60 * 1000 })
  return value
}
