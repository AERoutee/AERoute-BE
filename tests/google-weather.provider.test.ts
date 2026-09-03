jest.mock('../src/config/index.js', () => ({ env: { GOOGLE_MAPS_SERVER_KEY: 'weather-key', PROVIDER_TIMEOUT_MS: 4321 } }))

import { env } from '../src/config/index'
import { getForecastWeather } from '../src/modules/route-comparison/providers/google-weather.provider'

const mockEnv = env as { GOOGLE_MAPS_SERVER_KEY: string; PROVIDER_TIMEOUT_MS: number }
const fetchMock = jest.fn()
const hour = (startTime: string, feelsLikeC: number) => ({
  interval: { startTime, endTime: new Date(new Date(startTime).getTime() + 3_600_000).toISOString() }, isDaytime: true,
  weatherCondition: { type: 'CLEAR', description: { text: 'Clear' } }, temperature: { degrees: 28, unit: 'CELSIUS' }, feelsLikeTemperature: { degrees: feelsLikeC, unit: 'CELSIUS' }, heatIndex: { degrees: feelsLikeC, unit: 'CELSIUS' }, relativeHumidity: 70, uvIndex: 4,
  precipitation: { probability: { percent: 10 } }, thunderstormProbability: 5, wind: { speed: { value: 10, unit: 'KILOMETERS_PER_HOUR' }, gust: { value: 15, unit: 'KILOMETERS_PER_HOUR' } }, visibility: { distance: 10, unit: 'KILOMETERS' },
})
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('Google Weather provider', () => {
  beforeAll(() => { global.fetch = fetchMock as typeof fetch })
  beforeEach(() => { fetchMock.mockReset(); mockEnv.GOOGLE_MAPS_SERVER_KEY = 'weather-key' })

  it('selects the interval containing the actual target timestamp across an hour boundary', async () => {
    fetchMock.mockResolvedValue(response({ forecastHours: [hour('2026-09-01T10:00:00.000Z', 30), hour('2026-09-01T11:00:00.000Z', 36)] }))
    const result = await getForecastWeather({ latitude: 1, longitude: 2 }, new Date('2026-09-01T11:01:00.000Z'), new Date('2026-09-01T10:20:00.000Z'))
    expect(result).toMatchObject({ status: 'available', observedAt: '2026-09-01T11:00:00.000Z', feelsLikeC: 36, targetTime: '2026-09-01T11:01:00.000Z' })
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(Number(url.searchParams.get('hours'))).toBeGreaterThanOrEqual(2)
  })

  it('reattaches request-specific target metadata on cache hits', async () => {
    fetchMock.mockResolvedValue(response({ forecastHours: [hour('2026-09-09T11:00:00.000Z', 31)] }))
    const point = { latitude: 9, longitude: 9 }
    const first = await getForecastWeather(point, new Date('2026-09-09T11:05:00.000Z'), new Date('2026-09-09T10:00:00.000Z'))
    const second = await getForecastWeather(point, new Date('2026-09-09T11:45:00.000Z'), new Date('2026-09-09T10:15:00.000Z'))
    expect(first).toMatchObject({ targetTime: '2026-09-09T11:05:00.000Z', forecastOffsetMinutes: 65 })
    expect(second).toMatchObject({ targetTime: '2026-09-09T11:45:00.000Z', forecastOffsetMinutes: 90 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps provider, configuration, and invalid responses', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: { details: [{ reason: 'BILLING_DISABLED' }] } }, 403))
    await expect(getForecastWeather({ latitude: 2, longitude: 2 }, new Date('2026-09-02T11:00:00.000Z'), new Date('2026-09-02T10:00:00.000Z'))).rejects.toMatchObject({ code: 'weather_billing_required', retryable: false })
    fetchMock.mockResolvedValueOnce(response({ forecastHours: [] }))
    await expect(getForecastWeather({ latitude: 3, longitude: 2 }, new Date('2026-09-03T11:00:00.000Z'), new Date('2026-09-03T10:00:00.000Z'))).rejects.toMatchObject({ code: 'invalid_weather_response' })
    mockEnv.GOOGLE_MAPS_SERVER_KEY = ''
    await expect(getForecastWeather({ latitude: 4, longitude: 2 }, new Date('2026-09-04T11:00:00.000Z'), new Date('2026-09-04T10:00:00.000Z'))).rejects.toMatchObject({ code: 'weather_not_configured' })
  })

  it.each([
    ['SERVICE_DISABLED', 'weather_service_blocked'],
    ['API_KEY_EXPIRED', 'weather_key_invalid'],
  ])('maps permanent provider reason %s', async (reason, code) => {
    fetchMock.mockResolvedValue(response({ error: { details: [{ reason }] } }, 403))
    await expect(getForecastWeather({ latitude: reason.length, longitude: 3 }, new Date('2026-09-06T11:00:00.000Z'), new Date('2026-09-06T10:00:00.000Z'))).rejects.toMatchObject({ code, retryable: false })
  })

  it.each([[400, 502, false], [429, 503, true], [500, 502, true]] as const)('maps HTTP %s weather errors', async (status, statusCode, retryable) => {
    fetchMock.mockResolvedValue(response({ error: {} }, status))
    await expect(getForecastWeather({ latitude: status, longitude: 4 }, new Date('2026-09-07T11:00:00.000Z'), new Date('2026-09-07T10:00:00.000Z'))).rejects.toMatchObject({ code: 'weather_provider_error', statusCode, retryable })
  })

  it('selects the closest returned interval when none contains the target', async () => {
    fetchMock.mockResolvedValue(response({ forecastHours: [hour('2026-09-08T10:00:00.000Z', 30), hour('2026-09-08T12:00:00.000Z', 36)] }))
    await expect(getForecastWeather({ latitude: 8, longitude: 2 }, new Date('2026-09-08T11:50:00.000Z'), new Date('2026-09-08T10:00:00.000Z'))).resolves.toMatchObject({ observedAt: '2026-09-08T12:00:00.000Z' })
  })

  it('maps network failures to retryable unavailability', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'))
    await expect(getForecastWeather({ latitude: 5, longitude: 2 }, new Date('2026-09-05T11:00:00.000Z'), new Date('2026-09-05T10:00:00.000Z'))).rejects.toMatchObject({ code: 'weather_provider_unavailable', retryable: true })
  })
})
