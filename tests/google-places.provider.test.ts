jest.mock('../src/config/index.js', () => ({ env: { GOOGLE_MAPS_SERVER_KEY: 'places-key', PROVIDER_TIMEOUT_MS: 4321 } }))

import { env } from '../src/config/index'
import { getPlaceDetails, getPlacePhoto, getRestStopCandidates, getTransitStopDetails } from '../src/modules/route-comparison/providers/google-places.provider'

const mockEnv = env as { GOOGLE_MAPS_SERVER_KEY: string; PROVIDER_TIMEOUT_MS: number }
const fetchMock = jest.fn()
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('Google Places rest-stop provider', () => {
  beforeAll(() => { global.fetch = fetchMock as typeof fetch })
  beforeEach(() => { fetchMock.mockReset(); mockEnv.GOOGLE_MAPS_SERVER_KEY = 'places-key' })

  it('searches once along the encoded route and maps at most five candidates without safety claims', async () => {
    fetchMock.mockResolvedValue(response({ places: Array.from({ length: 6 }, (_, index) => ({ id: `p${index}`, displayName: { text: `Place ${index}` }, formattedAddress: 'Address', location: { latitude: 1, longitude: 2 }, types: ['cafe'], currentOpeningHours: { openNow: true }, restroom: true, accessibilityOptions: { wheelchairAccessibleEntrance: index === 0 }, googleMapsUri: 'https://maps.google.com/' })) }))
    const result = await getRestStopCandidates('encoded')
    expect(result.status).toBe('AVAILABLE')
    expect(result.candidates).toHaveLength(5)
    expect(result.candidates[0]).toMatchObject({ name: 'Place 0', restroom: true, accessibility: { wheelchairAccessibleEntrance: true }, safetyVerified: false })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText')
    expect(init.headers['X-Goog-FieldMask']).toContain('places.accessibilityOptions')
    expect(init.headers['X-Goog-FieldMask']).toContain('places.photos')
    expect(JSON.parse(String(init.body))).toEqual({ textQuery: 'public rest area restroom cafe park', pageSize: 5, searchAlongRouteParameters: { polyline: { encodedPolyline: 'encoded' } } })
  })

  it('maps at most three valid photos independently with safe source links and author attributions', async () => {
    fetchMock.mockResolvedValue(response({ places: [{ id: 'photo-place', displayName: { text: 'Photo Place' }, location: { latitude: 1, longitude: 2 }, photos: [
      { name: 'places/place_1/photos/photo_1', widthPx: 1200, heightPx: 800, googleMapsUri: 'https://www.google.com/maps/place/1', flagContentUri: 'https://support.google.com/legal/report/1', authorAttributions: [{ displayName: 'Author', uri: 'https://example.com/author', photoUri: 'https://example.com/photo.jpg' }] },
      { name: 'malformed' },
      { name: 'places/place_1/photos/photo_2', googleMapsUri: 'https://evil.example/maps', flagContentUri: 'http://support.google.com/legal/report/2' },
      { name: 'places/place_1/photos/photo_3' },
      { name: 'places/place_1/photos/photo_4' },
    ] }] }))
    await expect(getRestStopCandidates('encoded')).resolves.toEqual({ status: 'AVAILABLE', candidates: [{ id: 'photo-place', name: 'Photo Place', location: { latitude: 1, longitude: 2 }, types: [], photos: [
      { name: 'places/place_1/photos/photo_1', widthPx: 1200, heightPx: 800, googleMapsUri: 'https://www.google.com/maps/place/1', flagContentUri: 'https://support.google.com/legal/report/1', authorAttributions: [{ displayName: 'Author', uri: 'https://example.com/author', photoUri: 'https://example.com/photo.jpg' }] },
      { name: 'places/place_1/photos/photo_2' },
      { name: 'places/place_1/photos/photo_3' },
    ], safetyVerified: false }] })
  })

  it('maps candidates with omitted optional fields and drops unsafe place links', async () => {
    fetchMock.mockResolvedValue(response({ places: [{ id: 'minimal', displayName: { text: 'Minimal' }, location: { latitude: 1, longitude: 2 }, googleMapsUri: 'javascript:alert(1)', photos: [{ name: 'places/minimal/photos/photo_1' }] }] }))
    await expect(getRestStopCandidates('encoded')).resolves.toEqual({ status: 'AVAILABLE', candidates: [{ id: 'minimal', name: 'Minimal', location: { latitude: 1, longitude: 2 }, types: [], photos: [{ name: 'places/minimal/photos/photo_1' }], safetyVerified: false }] })
  })

  it('normalizes independent scheme-relative attribution links and drops unsafe links', async () => {
    fetchMock.mockResolvedValue(response({ places: [{ id: 'attributions', displayName: { text: 'Attributions' }, location: { latitude: 1, longitude: 2 }, photos: [{ name: 'places/attributions/photos/photo_1', authorAttributions: [
      { displayName: 'Profile only', uri: '//example.com/author' },
      { displayName: 'Photo only', photoUri: '//example.com/photo.jpg' },
      { displayName: 'Unsafe', uri: 'javascript:alert(1)', photoUri: 'http://example.com/photo.jpg' },
      { uri: 'https://example.com/missing-name' },
    ] }] }] }))
    const result = await getRestStopCandidates('encoded')
    expect(result).toEqual({ status: 'AVAILABLE', candidates: [{ id: 'attributions', name: 'Attributions', location: { latitude: 1, longitude: 2 }, types: [], photos: [{ name: 'places/attributions/photos/photo_1', authorAttributions: [
      { displayName: 'Profile only', uri: 'https://example.com/author' },
      { displayName: 'Photo only', photoUri: 'https://example.com/photo.jpg' },
      { displayName: 'Unsafe' },
    ] }], safetyVerified: false }] })
    expect(JSON.stringify(result)).not.toMatch(/javascript:|http:\/\//)
  })

  it('retains fresh candidates when one photo is malformed', async () => {
    fetchMock.mockResolvedValue(response({ places: [
      { id: 'bad-photo', displayName: { text: 'Bad Photo' }, location: { latitude: 1, longitude: 2 }, photos: [{ name: 'malformed', authorAttributions: [{ displayName: 'Unsafe', uri: 'javascript:alert(1)' }] }] },
      { id: 'good', displayName: { text: 'Good' }, location: { latitude: 3, longitude: 4 } },
    ] }))
    await expect(getRestStopCandidates('encoded')).resolves.toEqual({ status: 'AVAILABLE', candidates: [
      { id: 'bad-photo', name: 'Bad Photo', location: { latitude: 1, longitude: 2 }, types: [], safetyVerified: false },
      { id: 'good', name: 'Good', location: { latitude: 3, longitude: 4 }, types: [], safetyVerified: false },
    ] })
  })

  it('degrades missing configuration, provider failures, network failures, and invalid payloads', async () => {
    mockEnv.GOOGLE_MAPS_SERVER_KEY = ''
    await expect(getRestStopCandidates('encoded')).resolves.toMatchObject({ status: 'UNAVAILABLE', candidates: [] })
    mockEnv.GOOGLE_MAPS_SERVER_KEY = 'places-key'
    fetchMock.mockResolvedValueOnce(response({ error: {} }, 429)).mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(response({ places: [{ bad: true }] }))
    await expect(getRestStopCandidates('encoded')).resolves.toMatchObject({ status: 'UNAVAILABLE' })
    await expect(getRestStopCandidates('encoded')).resolves.toMatchObject({ status: 'UNAVAILABLE' })
    await expect(getRestStopCandidates('encoded')).resolves.toMatchObject({ status: 'UNAVAILABLE' })
  })
})

describe('Google Places transit-stop details provider', () => {
  beforeAll(() => { global.fetch = fetchMock as typeof fetch })
  beforeEach(() => { fetchMock.mockReset(); mockEnv.GOOGLE_MAPS_SERVER_KEY = 'places-key' })

  it('sends one bounded Text Search New request with the exact field mask', async () => {
    fetchMock.mockResolvedValue(response({ places: [] }))
    await expect(getTransitStopDetails({ name: 'Central Station', latitude: -6.2, longitude: 106.8 })).resolves.toEqual({ status: 'NOT_FOUND' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText')
    expect(init).toMatchObject({ method: 'POST', signal: expect.any(AbortSignal), headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': 'places-key', 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.currentOpeningHours,places.accessibilityOptions,places.restroom,places.parkingOptions,places.googleMapsUri,places.photos' } })
    expect(JSON.parse(String(init.body))).toEqual({ textQuery: 'Central Station', pageSize: 5, languageCode: 'en', locationBias: { circle: { center: { latitude: -6.2, longitude: 106.8 }, radius: 250 } } })
  })

  it('selects a normalized exact display-name match before earlier Google results', async () => {
    fetchMock.mockResolvedValue(response({ places: [
      { id: 'first', displayName: { text: 'Central Station Annex' }, location: { latitude: -6.2, longitude: 106.8001 }, types: ['transit_station'] },
      { id: 'exact', displayName: { text: '  CENTRAL   station ' }, location: { latitude: -6.2, longitude: 106.802 }, types: ['train_station'] },
    ] }))
    await expect(getTransitStopDetails({ name: 'Central Station', latitude: -6.2, longitude: 106.8 })).resolves.toMatchObject({ status: 'AVAILABLE', place: { id: 'exact', name: '  CENTRAL   station ' } })
  })

  it('preserves Google order for eligible non-exact candidates and accepts every transit type', async () => {
    const types = ['transit_station', 'transit_stop', 'bus_station', 'bus_stop', 'train_station', 'subway_station', 'light_rail_station', 'tram_stop']
    for (const type of types) {
      fetchMock.mockResolvedValueOnce(response({ places: [
        { id: `first-${type}`, displayName: { text: 'First' }, location: { latitude: 0, longitude: 0.002 }, types: [type] },
        { id: `near-${type}`, displayName: { text: 'Near' }, location: { latitude: 0, longitude: 0.0001 }, types: [type] },
      ] }))
      await expect(getTransitStopDetails({ name: 'Requested', latitude: 0, longitude: 0 })).resolves.toMatchObject({ status: 'AVAILABLE', place: { id: `first-${type}` } })
    }
  })

  it('rejects wrong types and candidates beyond 250 meters', async () => {
    fetchMock.mockResolvedValue(response({ places: [
      { id: 'wrong-type', displayName: { text: 'Central Station' }, location: { latitude: 0, longitude: 0 }, types: ['restaurant'] },
      { id: 'too-far', displayName: { text: 'Central Station' }, location: { latitude: 0, longitude: 0.0023 }, types: ['transit_station'] },
    ] }))
    await expect(getTransitStopDetails({ name: 'Central Station', latitude: 0, longitude: 0 })).resolves.toEqual({ status: 'NOT_FOUND' })
  })

  it('maps safe photos, facilities, accessibility, parking booleans, and explicit false values', async () => {
    fetchMock.mockResolvedValue(response({ places: [{
      id: 'station', displayName: { text: 'Central' }, formattedAddress: 'Main Street', location: { latitude: 1, longitude: 2 }, types: ['bus_station'],
      currentOpeningHours: { openNow: false }, restroom: false, accessibilityOptions: { wheelchairAccessibleEntrance: false, wheelchairAccessibleParking: true },
      parkingOptions: { freeParkingLot: false, paidParkingLot: true, freeStreetParking: false, paidStreetParking: true, valetParking: false, freeGarageParking: false, paidGarageParking: true },
      googleMapsUri: 'https://maps.google.com/station', photos: [{ name: 'places/station/photos/photo_1', authorAttributions: [{ displayName: 'Author', uri: '//example.com/author' }] }, { name: 'places/station/photos/photo_2' }],
    }] }))
    await expect(getTransitStopDetails({ name: 'Central', latitude: 1, longitude: 2 })).resolves.toEqual({ status: 'AVAILABLE', place: {
      id: 'station', name: 'Central', formattedAddress: 'Main Street', location: { latitude: 1, longitude: 2 }, types: ['bus_station'], openNow: false, restroom: false,
      accessibility: { wheelchairAccessibleEntrance: false, wheelchairAccessibleParking: true },
      parkingOptions: { freeParkingLot: false, paidParkingLot: true, freeStreetParking: false, paidStreetParking: true, valetParking: false, freeGarageParking: false, paidGarageParking: true },
      googleMapsUri: 'https://maps.google.com/station', photos: [{ name: 'places/station/photos/photo_1', authorAttributions: [{ displayName: 'Author', uri: 'https://example.com/author' }] }, { name: 'places/station/photos/photo_2' }], safetyVerified: false,
    } })
  })

  it('omits unknown facilities and malformed photos without dropping the place', async () => {
    fetchMock.mockResolvedValue(response({ places: [{ id: 'minimal', displayName: { text: 'Minimal' }, location: { latitude: 1, longitude: 2 }, types: ['transit_stop'], photos: [{ name: 'bad' }] }] }))
    await expect(getTransitStopDetails({ name: 'Minimal', latitude: 1, longitude: 2 })).resolves.toEqual({ status: 'AVAILABLE', place: { id: 'minimal', name: 'Minimal', location: { latitude: 1, longitude: 2 }, types: ['transit_stop'], safetyVerified: false } })
  })

  it('maps configuration, retryable, upstream, and invalid-payload errors without leaking the key', async () => {
    mockEnv.GOOGLE_MAPS_SERVER_KEY = ''
    await expect(getTransitStopDetails({ name: 'Central', latitude: 1, longitude: 2 })).rejects.toMatchObject({ statusCode: 503, code: 'transit_stop_details_not_configured', retryable: false })
    mockEnv.GOOGLE_MAPS_SERVER_KEY = 'places-key'
    fetchMock.mockRejectedValueOnce(new Error('network places-key'))
    await expect(getTransitStopDetails({ name: 'Central', latitude: 1, longitude: 2 })).rejects.toMatchObject({ statusCode: 503, retryable: true, message: expect.not.stringContaining('places-key') })
    for (const status of [429, 500]) {
      fetchMock.mockResolvedValueOnce(response({ error: 'places-key' }, status))
      await expect(getTransitStopDetails({ name: 'Central', latitude: 1, longitude: 2 })).rejects.toMatchObject({ statusCode: 503, retryable: true, message: expect.not.stringContaining('places-key') })
    }
    fetchMock.mockResolvedValueOnce(response({ error: 'places-key' }, 403))
    await expect(getTransitStopDetails({ name: 'Central', latitude: 1, longitude: 2 })).rejects.toMatchObject({ statusCode: 502, retryable: false, message: expect.not.stringContaining('places-key') })
    fetchMock.mockResolvedValueOnce(response({ places: [{ bad: true }] }))
    await expect(getTransitStopDetails({ name: 'Central', latitude: 1, longitude: 2 })).rejects.toMatchObject({ statusCode: 502, code: 'invalid_transit_stop_details_response', retryable: false })
  })
})

describe('Google Place Details provider', () => {
  beforeAll(() => { global.fetch = fetchMock as typeof fetch })
  beforeEach(() => { fetchMock.mockReset(); mockEnv.GOOGLE_MAPS_SERVER_KEY = 'places-key' })

  it('gets fresh details by stored Place ID without Text Search', async () => {
    fetchMock.mockResolvedValue(response({ id: 'stored-place', displayName: { text: 'Fresh Station' }, location: { latitude: 1, longitude: 2 }, types: ['train_station'], photos: [{ name: 'places/stored-place/photos/one' }] }))
    await expect(getPlaceDetails('stored-place')).resolves.toEqual({ status: 'AVAILABLE', place: { id: 'stored-place', name: 'Fresh Station', location: { latitude: 1, longitude: 2 }, types: ['train_station'], photos: [{ name: 'places/stored-place/photos/one' }], safetyVerified: false } })
    expect(fetchMock).toHaveBeenCalledWith('https://places.googleapis.com/v1/places/stored-place', expect.objectContaining({ method: 'GET', headers: { 'X-Goog-Api-Key': 'places-key', 'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,types,currentOpeningHours,accessibilityOptions,restroom,parkingOptions,googleMapsUri,photos,movedPlaceId' } }))
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('searchText')
  })

  it('returns current moved Place details as a normal result', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ id: 'stored-place', displayName: { text: 'Old Station' }, location: { latitude: 1, longitude: 2 }, types: ['train_station'], movedPlaceId: 'replacement-place' }))
      .mockResolvedValueOnce(response({ id: 'replacement-place', displayName: { text: 'Current Station' }, location: { latitude: 1, longitude: 2 }, types: ['train_station'] }))
    await expect(getPlaceDetails('stored-place')).resolves.toEqual({ status: 'AVAILABLE', place: { id: 'replacement-place', name: 'Current Station', location: { latitude: 1, longitude: 2 }, types: ['train_station'], safetyVerified: false } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ headers: expect.objectContaining({ 'X-Goog-FieldMask': expect.stringContaining('movedPlaceId') }) }))
    expect(fetchMock.mock.calls[1][0]).toBe('https://places.googleapis.com/v1/places/replacement-place')
  })

  it('returns NOT_FOUND only for valid missing Place Details', async () => {
    fetchMock.mockResolvedValue(response({}, 404))
    await expect(getPlaceDetails('stored-place')).resolves.toEqual({ status: 'NOT_FOUND' })
  })

  it('does not turn transient or permanent provider errors into NOT_FOUND', async () => {
    fetchMock.mockResolvedValueOnce(response({}, 500))
    await expect(getPlaceDetails('stored-place')).rejects.toMatchObject({ statusCode: 503, retryable: true })
    fetchMock.mockResolvedValueOnce(response({}, 403))
    await expect(getPlaceDetails('stored-place')).rejects.toMatchObject({ statusCode: 502, retryable: false })
  })

  it('rejects malformed stored Place IDs before fetch', async () => {
    await expect(getPlaceDetails('../searchText')).rejects.toMatchObject({ statusCode: 502, code: 'invalid_place_id' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('Google Places photo provider', () => {
  beforeAll(() => { global.fetch = fetchMock as typeof fetch })
  beforeEach(() => { fetchMock.mockReset(); mockEnv.GOOGLE_MAPS_SERVER_KEY = 'places-key' })

  it('fetches a bounded image through the fixed Google media endpoint', async () => {
    const body = Uint8Array.from([1, 2, 3])
    fetchMock.mockResolvedValue(new Response(body, { status: 200, headers: { 'Content-Type': 'image/webp', 'Content-Length': '3' } }))
    await expect(getPlacePhoto('places/place_1/photos/photo_1')).resolves.toEqual({ body: Buffer.from(body), contentType: 'image/webp' })
    expect(fetchMock).toHaveBeenCalledWith('https://places.googleapis.com/v1/places/place_1/photos/photo_1/media?maxWidthPx=640&maxHeightPx=360&skipHttpRedirect=false&key=places-key', expect.objectContaining({ redirect: 'follow', signal: expect.any(AbortSignal) }))
  })

  it.each(['https://example.com/image.jpg', 'places/a/photos/b?key=x', 'places/a/photos/b/c', 'places/a/../photos/b', 'places/a photos/b', `places/${'a'.repeat(257)}/photos/b`, `places/a/photos/${'b'.repeat(513)}`])('rejects invalid resource %s before fetch', async (name) => {
    await expect(getPlacePhoto(name)).rejects.toMatchObject({ statusCode: 400, code: 'validation_error', retryable: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([[404, 404, 'place_photo_unavailable', false], [400, 404, 'place_photo_unavailable', false], [410, 404, 'place_photo_unavailable', false], [429, 503, 'place_photo_provider_unavailable', true], [500, 503, 'place_photo_provider_unavailable', true]] as const)('maps upstream %s safely', async (upstream, statusCode, code, retryable) => {
    fetchMock.mockResolvedValue(new Response('provider secret places-key', { status: upstream, headers: { 'Content-Type': 'application/json' } }))
    await expect(getPlacePhoto('places/place_1/photos/photo_1')).rejects.toMatchObject({ statusCode, code, retryable, message: expect.not.stringContaining('places-key') })
  })

  it('rejects non-images and oversized declared or actual bodies', async () => {
    fetchMock.mockResolvedValueOnce(new Response('html', { headers: { 'Content-Type': 'text/html' } }))
    await expect(getPlacePhoto('places/place_1/photos/photo_1')).rejects.toMatchObject({ statusCode: 502, code: 'invalid_place_photo_response' })
    fetchMock.mockResolvedValueOnce(new Response(Uint8Array.of(1), { headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(3 * 1024 * 1024 + 1) } }))
    await expect(getPlacePhoto('places/place_1/photos/photo_1')).rejects.toMatchObject({ statusCode: 502, code: 'place_photo_too_large' })
    fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(3 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }))
    await expect(getPlacePhoto('places/place_1/photos/photo_1')).rejects.toMatchObject({ statusCode: 502, code: 'place_photo_too_large' })
  })

  it('keeps the API key out of errors and logs and maps missing configuration safely', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    fetchMock.mockRejectedValueOnce(new Error('network failure places-key'))
    await expect(getPlacePhoto('places/place_1/photos/photo_1')).rejects.toMatchObject({ statusCode: 503, retryable: true, message: expect.not.stringContaining('places-key') })
    mockEnv.GOOGLE_MAPS_SERVER_KEY = ''
    await expect(getPlacePhoto('places/place_1/photos/photo_1')).rejects.toMatchObject({ statusCode: 503, code: 'place_photo_not_configured', retryable: false, message: expect.not.stringContaining('places-key') })
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
