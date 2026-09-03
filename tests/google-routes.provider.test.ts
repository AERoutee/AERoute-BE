jest.mock('../src/config/index.js', () => ({ env: { GOOGLE_MAPS_SERVER_KEY: 'routes-key', PROVIDER_TIMEOUT_MS: 4321 } }))

import { env } from '../src/config/index'
import { AppError } from '../src/middleware/errors'
import { getRoutes } from '../src/modules/route-comparison/providers/google-routes.provider'

const mockEnv = env as { GOOGLE_MAPS_SERVER_KEY: string, PROVIDER_TIMEOUT_MS: number }
const fetchMock = jest.fn()
const input = {
  origin: { latitude: -6.2, longitude: 106.8 }, destination: { latitude: -6.21, longitude: 106.81 }, mode: 'WALK' as const, preference: 'balanced' as const, sensitiveUser: false,
  accessibilityMode: 'STANDARD' as const, departureOffsetsMinutes: [0] as Array<0 | 30 | 60>, hazardPolicy: 'PREFER_FEWER_REPORTS' as const, includeRestStops: true,
}
const providerResponse = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const expectAppError = (promise: Promise<unknown>, statusCode: number, code: string, retryable: boolean) => expect(promise).rejects.toEqual(expect.objectContaining({ statusCode, code, retryable }))

describe('Google Routes provider', () => {
  beforeAll(() => { global.fetch = fetchMock as typeof fetch })
  beforeEach(() => { fetchMock.mockReset(); mockEnv.GOOGLE_MAPS_SERVER_KEY = 'routes-key' })

  it('sends active-travel request fields and preserves provider labels', async () => {
    fetchMock.mockResolvedValue(providerResponse({ routes: [{ distanceMeters: 1234, duration: '601.5s', polyline: { encodedPolyline: 'encoded-one' }, routeLabels: ['DEFAULT_ROUTE'] }] }))
    await expect(getRoutes(input)).resolves.toEqual([{ id: 'route_1', durationSeconds: 601.5, distanceMeters: 1234, encodedPolyline: 'encoded-one', providerLabels: ['DEFAULT_ROUTE'] }])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes')
    expect(init.headers).toMatchObject({ 'X-Goog-Api-Key': 'routes-key', 'X-Goog-FieldMask': expect.stringContaining('routes.legs.steps.staticDuration') })
    const fieldMask = String((init.headers as Record<string, string>)['X-Goog-FieldMask'])
    expect(fieldMask).not.toContain('routes.legs.steps.duration')
    expect(fieldMask).toEqual(expect.stringContaining('routes.legs.steps.startLocation'))
    expect(fieldMask).toEqual(expect.stringContaining('routes.legs.steps.endLocation'))
    expect(fieldMask).toEqual(expect.stringContaining('routes.legs.steps.polyline.encodedPolyline'))
    expect(fieldMask).toEqual(expect.stringContaining('routes.legs.steps.transitDetails.stopDetails.departureTime'))
    expect(fieldMask).toEqual(expect.stringContaining('routes.legs.steps.transitDetails.stopDetails.arrivalTime'))
    expect(fieldMask).toEqual(expect.stringContaining('routes.warnings'))
    expect(JSON.parse(String(init.body))).toEqual({ origin: { location: { latLng: input.origin } }, destination: { location: { latLng: input.destination } }, travelMode: 'WALK', computeAlternativeRoutes: true, polylineQuality: 'HIGH_QUALITY', languageCode: 'en', units: 'METRIC' })
  })

  it('builds transit requests and preserves ordered step geometry, schedules, warnings, and actual modes across legs', async () => {
    fetchMock.mockResolvedValue(providerResponse({ routes: [{ distanceMeters: 5000, duration: '1800s', polyline: { encodedPolyline: 'transit' }, routeLabels: ['DEFAULT_ROUTE'], warnings: ['Walking and cycling routes are in beta.'], legs: [
      { steps: [
        { travelMode: 'WALK', staticDuration: '300s', distanceMeters: 400, startLocation: { latLng: { latitude: 0, longitude: 1 } }, endLocation: { latLng: { latitude: 1, longitude: 2 } }, polyline: { encodedPolyline: 'walk-in' } },
        { travelMode: 'TRANSIT', staticDuration: '900s', distanceMeters: 4200, startLocation: { latLng: { latitude: 1, longitude: 2 } }, endLocation: { latLng: { latitude: 3, longitude: 4 } }, polyline: { encodedPolyline: 'ride' }, transitDetails: { stopDetails: { departureStop: { name: 'Central', location: { latLng: { latitude: 1, longitude: 2 } } }, arrivalStop: { name: 'Park', location: { latLng: { latitude: 3, longitude: 4 } } }, departureTime: '2026-09-01T10:35:00Z', arrivalTime: '2026-09-01T10:50:00Z' }, headsign: 'Park', transitLine: { name: 'Blue Line', nameShort: 'B', vehicle: { type: 'BUS', name: { text: 'Bus' } } }, stopCount: 5 } },
      ] },
      { steps: [{ travelMode: 'WALK', staticDuration: '120s', distanceMeters: 150, startLocation: { latLng: { latitude: 3, longitude: 4 } }, endLocation: { latLng: { latitude: 5, longitude: 6 } }, polyline: { encodedPolyline: 'walk-out' } }] },
    ] }] }))
    const now = new Date('2026-09-01T10:00:00.000Z')
    const transit = { ...input, mode: 'TRANSIT' as const, transitModes: ['BUS'] as Array<'BUS'>, accessibilityMode: 'REDUCED_EXERTION' as const }
    const result = await getRoutes(transit, 30, now)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(body).toEqual(expect.objectContaining({ travelMode: 'TRANSIT', departureTime: '2026-09-01T10:30:00.000Z', transitPreferences: { allowedTravelModes: ['BUS'], routingPreference: 'LESS_WALKING' } }))
    expect(body).not.toHaveProperty('routeModifiers')
    expect(result[0]).toMatchObject({ warnings: ['Walking and cycling routes are in beta.'] })
    expect(result[0].transitSummary).toEqual({
      walkingDurationSeconds: 420,
      walkingDistanceMeters: 550,
      transfers: 0,
      preferredTransitModes: ['BUS'],
      actualTransitModes: ['BUS'],
      segments: [
        { travelMode: 'WALK', durationSeconds: 300, distanceMeters: 400, encodedPolyline: 'walk-in', startLocation: { latitude: 0, longitude: 1 }, endLocation: { latitude: 1, longitude: 2 } },
        { travelMode: 'TRANSIT', durationSeconds: 900, distanceMeters: 4200, encodedPolyline: 'ride', startLocation: { latitude: 1, longitude: 2 }, endLocation: { latitude: 3, longitude: 4 }, lineName: 'Blue Line', lineShortName: 'B', vehicleType: 'BUS', headsign: 'Park', departureTime: '2026-09-01T10:35:00Z', arrivalTime: '2026-09-01T10:50:00Z', departureStop: { name: 'Central', location: { latitude: 1, longitude: 2 } }, arrivalStop: { name: 'Park', location: { latitude: 3, longitude: 4 } }, stopCount: 5 },
        { travelMode: 'WALK', durationSeconds: 120, distanceMeters: 150, encodedPolyline: 'walk-out', startLocation: { latitude: 3, longitude: 4 }, endLocation: { latitude: 5, longitude: 6 } },
      ],
      stations: [{ name: 'Central', location: { latitude: 1, longitude: 2 } }, { name: 'Park', location: { latitude: 3, longitude: 4 } }],
    })
  })

  it('preserves every provider step in exact order', async () => {
    fetchMock.mockResolvedValue(providerResponse({ routes: [{ distanceMeters: 10, duration: '10s', polyline: { encodedPolyline: 'x' }, legs: [{ steps: [
      { travelMode: 'WALK', staticDuration: '2s', distanceMeters: 2 },
      { travelMode: 'BICYCLE', staticDuration: '3s', distanceMeters: 3 },
      { travelMode: 'TRANSIT', staticDuration: '5s', distanceMeters: 5 },
    ] }] }] }))
    const result = await getRoutes({ ...input, mode: 'TRANSIT' })
    expect(result[0].transitSummary?.segments.map((segment) => 'travelMode' in segment ? segment.travelMode : segment.mode)).toEqual(['WALK', 'BICYCLE', 'TRANSIT'])
  })

  it('honors explicit transit preference over reduced-exertion mapping', async () => {
    fetchMock.mockResolvedValue(providerResponse({ routes: [{ distanceMeters: 1, duration: '1s', polyline: { encodedPolyline: 'x' } }] }))
    await getRoutes({ ...input, mode: 'TRANSIT', accessibilityMode: 'REDUCED_EXERTION', transitPreference: 'FEWER_TRANSFERS' })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).transitPreferences.routingPreference).toBe('FEWER_TRANSFERS')
  })

  it('disables alternatives for bounded access requests', async () => {
    fetchMock.mockResolvedValue(providerResponse({ routes: [{ distanceMeters: 1, duration: '1s', polyline: { encodedPolyline: 'x' } }] }))
    await getRoutes(input, 0, new Date(), { computeAlternativeRoutes: false })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).computeAlternativeRoutes).toBe(false)
  })

  it.each([
    ['WALK', {}, 'walking_route_unavailable'],
    ['WALK', { routes: [] }, 'walking_route_unavailable'],
    ['BICYCLE', {}, 'cycling_route_unavailable'],
    ['BICYCLE', { routes: [] }, 'cycling_route_unavailable'],
    ['TRANSIT', {}, 'transit_route_unavailable'],
    ['TRANSIT', { routes: [] }, 'transit_route_unavailable'],
  ] as const)('maps empty successful %s payloads to nonretryable 422', async (mode, payload, code) => {
    fetchMock.mockResolvedValue(providerResponse(payload))
    await expectAppError(getRoutes({ ...input, mode }), 422, code, false)
  })

  it('fails before fetch when the key is missing', async () => {
    mockEnv.GOOGLE_MAPS_SERVER_KEY = ''
    const promise = getRoutes(input)
    await expectAppError(promise, 503, 'route_provider_not_configured', false)
    await expect(promise).rejects.toBeInstanceOf(AppError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps invalid provider arguments to a safe actionable error', async () => {
    fetchMock.mockResolvedValue(providerResponse({ error: { status: 'INVALID_ARGUMENT', message: 'field mask contained secret routes-key' } }, 400))
    const promise = getRoutes(input)
    await expectAppError(promise, 400, 'route_provider_invalid_argument', false)
    await expect(promise).rejects.not.toHaveProperty('message', expect.stringContaining('routes-key'))
  })

  it.each([[400, 502, false], [429, 503, true], [503, 502, true]] as const)('maps HTTP %s failures', async (providerStatus, statusCode, retryable) => {
    fetchMock.mockResolvedValue(providerResponse({ error: {} }, providerStatus))
    await expectAppError(getRoutes(input), statusCode, 'route_provider_error', retryable)
  })

  it('maps network and invalid payload failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network'))
    await expectAppError(getRoutes(input), 503, 'route_provider_unavailable', true)
    fetchMock.mockResolvedValueOnce(providerResponse('not-json'))
    await expectAppError(getRoutes(input), 502, 'invalid_route_response', true)
  })
})
