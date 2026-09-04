jest.mock('../src/config/index.js', () => ({ env: { GOOGLE_MAPS_SERVER_KEY: 'provider-key', PROVIDER_TIMEOUT_MS: 4321 } }))

import { env } from '../src/config/index'
import { getRouteAirQuality } from '../src/modules/route-comparison/providers/google-air-quality.provider'

const mockEnv = env as { GOOGLE_MAPS_SERVER_KEY: string; PROVIDER_TIMEOUT_MS: number }
const fetchMock = jest.fn()
const polyline = '_p~iF~ps|U_ulLnnqC_mqNvxq`@'
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const pollutants = (value: number) => [{ code: 'pm25', concentration: { value, units: 'MICROGRAMS_PER_CUBIC_METER' } }]

describe('Google Air Quality provider', () => {
  beforeAll(() => { global.fetch = fetchMock as typeof fetch })
  beforeEach(() => { fetchMock.mockReset(); mockEnv.GOOGLE_MAPS_SERVER_KEY = 'provider-key' })

  it('uses current conditions for offset zero', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(response({ dateTime: '2026-09-01T10:00:00.000Z', pollutants: pollutants(12) })))
    const now = new Date('2026-09-01T10:10:00.000Z')
    const result = await getRouteAirQuality(polyline, now, 600, now)
    expect(result).toMatchObject({ averagePm25: 12, temporalResolution: 'CURRENT_CONDITIONS', approximate: false, sampleCount: 5 })
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('currentConditions:lookup'))).toBe(true)
    expect(fetchMock.mock.calls.every((call) => JSON.parse(String(call[1].body)).languageCode === 'id')).toBe(true)
  })

  it('coalesces concurrent lookups for the same rounded point and time bucket', async () => {
    const releases: Array<(value: Response) => void> = []
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { releases.push(resolve) }))
    const first = getRouteAirQuality(polyline, new Date('2026-09-09T10:00:00.000Z'), 0, new Date('2026-09-09T10:00:00.000Z'))
    const second = getRouteAirQuality(polyline, new Date('2026-09-09T10:00:00.000Z'), 0, new Date('2026-09-09T10:00:00.000Z'))
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(5)
    releases.forEach((release) => release(response({ dateTime: '2026-09-09T10:00:00.000Z', pollutants: pollutants(12) })))
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  })

  it('uses forecast lookup with target dateTime and hourly disclosure for future offsets', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(response({ hourlyForecasts: [{ dateTime: '2026-09-01T10:00:00.000Z', pollutants: pollutants(8) }] })))
    const now = new Date('2026-09-01T10:10:00.000Z')
    const departure = new Date('2026-09-01T10:40:00.000Z')
    const result = await getRouteAirQuality(polyline, departure, 1200, now)
    expect(result).toMatchObject({ averagePm25: 8, temporalResolution: 'HOURLY_BUCKET', approximate: true })
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('forecast:lookup'))).toBe(true)
    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1].body)).dateTime)).toEqual([
      '2026-09-01T10:40:00.000Z', '2026-09-01T10:45:00.000Z', '2026-09-01T10:50:00.000Z', '2026-09-01T10:55:00.000Z', '2026-09-01T11:00:00.000Z',
    ])
  })

  it('keeps partial samples but surfaces permanent configuration errors', async () => {
    fetchMock.mockResolvedValueOnce(response({ dateTime: '2026-09-01T10:00:00.000Z', pollutants: pollutants(10) })).mockResolvedValue(response({ error: {} }, 500))
    await expect(getRouteAirQuality(polyline)).resolves.toMatchObject({ dataQuality: 'partial_estimate', sampleCount: 1 })
    fetchMock.mockReset().mockResolvedValue(response({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } }, 403))
    await expect(getRouteAirQuality(polyline, new Date('2026-09-02T10:30:00.000Z'), 0, new Date('2026-09-02T10:00:00.000Z'))).rejects.toMatchObject({ code: 'air_quality_service_blocked', retryable: false })
  })

  it('maps network, invalid payload, missing pollutant, and complete temporary failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'))
    await expect(getRouteAirQuality(polyline, new Date('2026-09-03T10:30:00.000Z'), 0, new Date('2026-09-03T10:00:00.000Z'))).rejects.toMatchObject({ code: 'air_quality_provider_unavailable' })
    fetchMock.mockImplementation(() => Promise.resolve(response({ bad: true })))
    await expect(getRouteAirQuality(polyline, new Date('2026-09-04T10:30:00.000Z'), 0, new Date('2026-09-04T10:00:00.000Z'))).rejects.toMatchObject({ code: 'invalid_air_quality_response' })
    fetchMock.mockImplementation(() => Promise.resolve(response({ hourlyForecasts: [{ dateTime: '2026-09-05T10:00:00.000Z', pollutants: [] }] })))
    await expect(getRouteAirQuality(polyline, new Date('2026-09-05T10:30:00.000Z'), 0, new Date('2026-09-05T10:00:00.000Z'))).rejects.toMatchObject({ code: 'pm25_unavailable' })
  })

  it('preserves unrecognized permanent provider errors', async () => {
    fetchMock.mockResolvedValue(response({ error: { status: 'PERMISSION_DENIED' } }, 403))
    await expect(getRouteAirQuality(polyline, new Date('2026-09-06T10:30:00.000Z'), 0, new Date('2026-09-06T10:00:00.000Z'))).rejects.toMatchObject({ code: 'air_quality_provider_error', retryable: false })
  })

  it.each([
    ['BILLING_DISABLED', 'air_quality_billing_required'],
    ['API_KEY_INVALID', 'air_quality_key_invalid'],
  ])('maps permanent provider reason %s', async (reason, code) => {
    fetchMock.mockImplementation(() => Promise.resolve(response({ error: { details: [{ reason }] } }, 403)))
    await expect(getRouteAirQuality(polyline, new Date(`2026-09-${reason === 'BILLING_DISABLED' ? '06' : '07'}T10:30:00.000Z`), 0, new Date(`2026-09-${reason === 'BILLING_DISABLED' ? '06' : '07'}T10:00:00.000Z`))).rejects.toMatchObject({ code, retryable: false })
  })

  it('rejects malformed or empty route geometry and missing configuration', async () => {
    await expect(getRouteAirQuality('?')).rejects.toMatchObject({ code: 'invalid_route_geometry' })
    await expect(getRouteAirQuality('')).rejects.toMatchObject({ code: 'invalid_route_geometry' })
    mockEnv.GOOGLE_MAPS_SERVER_KEY = ''
    await expect(getRouteAirQuality(polyline, new Date('2026-09-08T10:30:00.000Z'), 0, new Date('2026-09-08T10:00:00.000Z'))).rejects.toMatchObject({ code: 'air_quality_not_configured' })
  })
})
