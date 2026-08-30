import { z } from 'zod'
import { env } from '../../../config/index.js'
import { AppError } from '../../../middleware/index.js'
import type { WeatherConditions } from '../weather-advisory.service.js'

const measureSchema = z.object({ degrees: z.number(), unit: z.literal('CELSIUS') })
const speedSchema = z.object({ value: z.number().nonnegative(), unit: z.literal('KILOMETERS_PER_HOUR') })
const forecastHourSchema = z.object({
  interval: z.object({ startTime: z.string().datetime(), endTime: z.string().datetime() }),
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
const forecastResponseSchema = z.object({ forecastHours: z.array(forecastHourSchema).min(1) })
const googleErrorSchema = z.object({ error: z.object({ details: z.array(z.object({ reason: z.string().optional() }).passthrough()).optional() }) })
const cache = new Map<string, { expiresAt: number; value: WeatherConditions }>()

type Point = { latitude: number; longitude: number }

async function providerError(response: Response) {
  const parsed = googleErrorSchema.safeParse(await response.json().catch(() => null))
  const reason = parsed.success ? parsed.data.error.details?.find((detail) => detail.reason)?.reason : undefined
  if (reason === 'BILLING_DISABLED') return new AppError(503, 'weather_billing_required', 'Weather service billing is not enabled.', false)
  if (reason === 'API_KEY_SERVICE_BLOCKED' || reason === 'SERVICE_DISABLED') return new AppError(503, 'weather_service_blocked', 'Weather API is not enabled for this server key.', false)
  if (reason === 'API_KEY_INVALID' || reason === 'API_KEY_EXPIRED') return new AppError(503, 'weather_key_invalid', 'Weather service credentials are invalid.', false)
  return new AppError(response.status === 429 ? 503 : 502, 'weather_provider_error', 'Weather forecast is unavailable.', response.status >= 500 || response.status === 429)
}

export async function getForecastWeather(point: Point, etaSeconds: number): Promise<WeatherConditions> {
  const apiKey = env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) throw new AppError(503, 'weather_not_configured', 'Weather data is not configured.', false)
  const forecastOffsetMinutes = Math.min(23 * 60, Math.max(0, Math.round(etaSeconds / 60)))
  const hourIndex = Math.min(23, Math.max(0, Math.floor(forecastOffsetMinutes / 60)))
  const targetHour = Math.floor((Date.now() + forecastOffsetMinutes * 60_000) / 3_600_000)
  const cacheKey = `forecast:${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}:${targetHour}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const url = new URL('https://weather.googleapis.com/v1/forecast/hours:lookup')
  url.searchParams.set('key', apiKey)
  url.searchParams.set('location.latitude', String(point.latitude))
  url.searchParams.set('location.longitude', String(point.longitude))
  url.searchParams.set('unitsSystem', 'METRIC')
  url.searchParams.set('languageCode', 'en')
  url.searchParams.set('hours', String(hourIndex + 1))
  url.searchParams.set('pageSize', String(hourIndex + 1))

  const response = await fetch(url, { signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS) }).catch(() => { throw new AppError(503, 'weather_provider_unavailable', 'Weather forecast is unavailable.', true) })
  if (!response.ok) throw await providerError(response)
  const parsed = forecastResponseSchema.safeParse(await response.json())
  if (!parsed.success) throw new AppError(502, 'invalid_weather_response', 'Weather service returned an invalid forecast response.', true)
  const data = parsed.data.forecastHours[Math.min(hourIndex, parsed.data.forecastHours.length - 1)]
  const value: WeatherConditions = {
    status: 'available',
    observedAt: data.interval.startTime,
    forecastOffsetMinutes,
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
  cache.set(cacheKey, { value, expiresAt: Date.now() + 30 * 60 * 1000 })
  return value
}
