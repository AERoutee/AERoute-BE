jest.mock('../src/config/index.js', () => ({ env: { GOOGLE_MAPS_SERVER_KEY: 'routes-key', PROVIDER_TIMEOUT_MS: 4321 } }))

import { env } from '../src/config/index'
import { AppError } from '../src/middleware/errors'
import { getRoutes } from '../src/modules/route-comparison/providers/google-routes.provider'

const mockEnv = env as { GOOGLE_MAPS_SERVER_KEY: string, PROVIDER_TIMEOUT_MS: number }

const fetchMock = jest.fn()
const input = {
  origin: { latitude: -6.2, longitude: 106.8 },
  destination: { latitude: -6.21, longitude: 106.81 },
  mode: 'WALK' as const,
  preference: 'balanced' as const,
  sensitiveUser: false,
}

function providerResponse(body: unknown, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function expectAppError(promise: Promise<unknown>, statusCode: number, code: string, retryable: boolean) {
  return expect(promise).rejects.toEqual(expect.objectContaining({ statusCode, code, retryable }))
}

describe('Google Routes provider', () => {
  beforeAll(() => { global.fetch = fetchMock as typeof fetch })
  beforeEach(() => {
    fetchMock.mockReset()
    mockEnv.GOOGLE_MAPS_SERVER_KEY = 'routes-key'
  })

  it('sends the required request contract and maps successful alternatives', async () => {
    fetchMock.mockResolvedValue(providerResponse({ routes: [
      { distanceMeters: 1234, duration: '601.5s', polyline: { encodedPolyline: 'encoded-one' }, routeLabels: ['DEFAULT_ROUTE'] },
      { distanceMeters: 1400, duration: '720s', polyline: { encodedPolyline: 'encoded-two' } },
    ] }))

    await expect(getRoutes(input)).resolves.toEqual([
      { id: 'route_1', durationSeconds: 601.5, distanceMeters: 1234, encodedPolyline: 'encoded-one' },
      { id: 'route_2', durationSeconds: 720, distanceMeters: 1400, encodedPolyline: 'encoded-two' },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes')
    expect(init).toMatchObject({ method: 'POST', headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': 'routes-key',
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.routeLabels',
    } })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(String(init.body))).toEqual({
      origin: { location: { latLng: input.origin } },
      destination: { location: { latLng: input.destination } },
      travelMode: 'WALK',
      computeAlternativeRoutes: true,
      polylineQuality: 'HIGH_QUALITY',
      languageCode: 'en',
      units: 'METRIC',
    })
  })

  it('requests bicycle travel mode', async () => {
    fetchMock.mockResolvedValue(providerResponse({ routes: [{ distanceMeters: 1000, duration: '600s', polyline: { encodedPolyline: 'encoded' } }] }))
    await getRoutes({ ...input, mode: 'BICYCLE' })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ travelMode: 'BICYCLE' })
  })

  it('fails before fetch when the server key is missing', async () => {
    mockEnv.GOOGLE_MAPS_SERVER_KEY = ''
    const promise = getRoutes(input)
    await expectAppError(promise, 503, 'route_provider_not_configured', false)
    await expect(promise).rejects.toBeInstanceOf(AppError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps network failures to a retryable unavailable error', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'))
    await expectAppError(getRoutes(input), 503, 'route_provider_unavailable', true)
  })

  it.each([400, 403])('does not disguise cycling HTTP %s failures as missing coverage', async (providerStatus) => {
    fetchMock.mockResolvedValue(providerResponse({ error: { message: 'provider failure' } }, providerStatus))
    await expectAppError(getRoutes({ ...input, mode: 'BICYCLE' }), 502, 'route_provider_error', false)
  })

  it.each([
    [400, 502, false],
    [429, 503, true],
    [503, 502, true],
  ])('maps HTTP %s provider failures', async (providerStatus, statusCode, retryable) => {
    fetchMock.mockResolvedValue(providerResponse({ error: { message: 'provider failure' } }, providerStatus))
    await expectAppError(getRoutes(input), statusCode, 'route_provider_error', retryable)
  })

  it.each([
    [{ routes: [] }, 'WALK', 502, 'invalid_route_response', true],
    [{ routes: [{ distanceMeters: -1, duration: 'bad', polyline: { encodedPolyline: '' } }] }, 'WALK', 502, 'invalid_route_response', true],
    [{}, 'BICYCLE', 422, 'cycling_route_unavailable', false],
    [{ routes: [] }, 'BICYCLE', 422, 'cycling_route_unavailable', false],
    [{ routes: [{ distanceMeters: -1, duration: 'bad', polyline: { encodedPolyline: '' } }] }, 'BICYCLE', 502, 'invalid_route_response', true],
  ] as const)('rejects invalid successful payloads for %s', async (payload, mode, statusCode, code, retryable) => {
    fetchMock.mockResolvedValue(providerResponse(payload))
    await expectAppError(getRoutes({ ...input, mode }), statusCode, code, retryable)
  })

  it('rejects invalid JSON as an invalid provider response', async () => {
    fetchMock.mockResolvedValue(providerResponse('not-json'))
    await expectAppError(getRoutes(input), 502, 'invalid_route_response', true)
  })
})
