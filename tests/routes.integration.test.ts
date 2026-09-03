jest.mock('../src/config/index.js', () => ({ auth: { api: { getSession: jest.fn() } } }))
jest.mock('../src/modules/route-comparison/providers/google-places.provider.js', () => ({ getTransitStopDetails: jest.fn() }))

import express from 'express'
import type { Server } from 'node:http'
import { auth } from '../src/config/index'
import { API_ENDPOINTS, openApiDocument } from '../src/config/swagger'
import { AppError, errorHandler } from '../src/middleware/errors'
import { InsightsController } from '../src/modules/insights/insights.controller'
import createInsightsRoutes from '../src/modules/insights/insights.routes'
import { ProfileController } from '../src/modules/profile/profile.controller'
import createProfileRoutes from '../src/modules/profile/profile.routes'
import { RecoveryController } from '../src/modules/recovery/recovery.controller'
import createRecoveryRoutes from '../src/modules/recovery/recovery.routes'
import { RoadReportController } from '../src/modules/road-report/road-report.controller'
import createRoadReportRoutes from '../src/modules/road-report/road-report.routes'
import { getTransitStopDetails } from '../src/modules/route-comparison/providers/google-places.provider'
import { RouteComparisonController } from '../src/modules/route-comparison/route-comparison.controller'
import createRouteComparisonRoutes from '../src/modules/route-comparison/route-comparison.routes'
import { TransitStopDetailsController } from '../src/modules/route-comparison/transit-stop-details.controller'
import createTransitStopDetailsRoutes from '../src/modules/route-comparison/transit-stop-details.routes'

const getSession = jest.mocked(auth.api.getSession)
const transitStopDetails = jest.mocked(getTransitStopDetails)
const recovery = {
  request: jest.fn(), read: jest.fn(), resend: jest.fn(), verify: jest.fn(), reset: jest.fn(),
}
const profile = { readAvatar: jest.fn(), uploadAvatar: jest.fn(), removeAvatar: jest.fn() }
const insights = { savedCommutes: jest.fn(), createSavedCommute: jest.fn(), updateSavedCommute: jest.fn(), deleteSavedCommute: jest.fn(), recordTripImpact: jest.fn(), tripImpactSummary: jest.fn() }
const reports = { image: jest.fn(), nearby: jest.fn(), mine: jest.fn(), create: jest.fn(), verify: jest.fn(), retractVerification: jest.fn(), resolve: jest.fn() }
const comparisons = { compare: jest.fn(), photo: jest.fn() }
const validComparison = {
  origin: { latitude: -6.2, longitude: 106.8 },
  destination: { latitude: -6.21, longitude: 106.81 },
  mode: 'WALK', preference: 'balanced', sensitiveUser: false,
}

let server: Server
let baseUrl: string

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use('/api/v1', createRecoveryRoutes(new RecoveryController(recovery as never)))
  app.use('/api/v1', createInsightsRoutes(new InsightsController(insights as never)))
  app.use('/api/v1', createProfileRoutes(new ProfileController(profile as never)))
  app.use('/api/v1', createRoadReportRoutes(new RoadReportController(reports as never)))
  app.use('/api/v1', createRouteComparisonRoutes(new RouteComparisonController(comparisons as never)))
  app.use('/api/v1', createTransitStopDetailsRoutes(new TransitStopDetailsController({ details: transitStopDetails } as never)))
  app.use(errorHandler)
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to TCP')
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`
})

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

beforeEach(() => {
  jest.resetAllMocks()
  getSession.mockResolvedValue(null as never)
  recovery.request.mockResolvedValue({ id: 'challenge-1' })
  recovery.read.mockResolvedValue({ maskedEmail: 'a***@example.com' })
  recovery.resend.mockResolvedValue({ id: 'challenge-2' })
  recovery.verify.mockResolvedValue({ verified: true })
  recovery.reset.mockResolvedValue({ success: true })
  profile.readAvatar.mockResolvedValue(Buffer.from('avatar'))
  profile.uploadAvatar.mockResolvedValue({ image: 'https://cdn.example.com/avatar.webp' })
  profile.removeAvatar.mockResolvedValue({ image: null })
  reports.image.mockResolvedValue({ body: Buffer.from('image'), contentType: 'image/webp', etag: 'etag' })
  reports.nearby.mockResolvedValue([{ id: 'report-1' }])
  reports.mine.mockResolvedValue([{ id: 'report-1' }])
  reports.create.mockResolvedValue({ id: 'report-1' })
  reports.verify.mockResolvedValue({ verification: { confirmations: 1 } })
  reports.retractVerification.mockResolvedValue({ verification: { confirmations: 0 } })
  reports.resolve.mockResolvedValue({ id: 'report-1', status: 'RESOLVED' })
  insights.savedCommutes.mockResolvedValue([{ id: 'commute-1' }])
  insights.createSavedCommute.mockResolvedValue({ id: 'commute-1' })
  insights.updateSavedCommute.mockResolvedValue({ id: 'commute-1' })
  insights.deleteSavedCommute.mockResolvedValue({ deleted: true })
  insights.recordTripImpact.mockResolvedValue({ id: 'trip-1' })
  insights.tripImpactSummary.mockResolvedValue({ completedTrips: 1 })
  comparisons.compare.mockResolvedValue({ comparisonId: 'comparison-1', routes: [{ id: 'route-1' }] })
  comparisons.photo.mockResolvedValue({ body: Buffer.from([1, 2, 3]), contentType: 'image/jpeg' })
  transitStopDetails.mockResolvedValue({ status: 'NOT_FOUND' })
})

async function json(response: Response) {
  return { status: response.status, body: await response.json() }
}

describe('app-owned route registration over HTTP', () => {
  it.each([
    ['POST', '/recovery-challenges', { email: 'person@example.com' }, recovery.request, ['person@example.com', expect.any(Headers)]],
    ['GET', '/recovery-challenges/challenge-1', undefined, recovery.read, ['challenge-1']],
    ['POST', '/recovery-challenges/challenge-1/resend', {}, recovery.resend, ['challenge-1', expect.any(Headers)]],
    ['POST', '/recovery-challenges/challenge-1/verify', { otp: '123456' }, recovery.verify, ['challenge-1', '123456']],
    ['POST', '/recovery-challenges/challenge-1/reset', { otp: '123456', password: 'password8' }, recovery.reset, ['challenge-1', '123456', 'password8']],
  ] as const)('registers %s %s', async (method, path, body, handler, expectedArgs) => {
    const response = await fetch(baseUrl + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledWith(...expectedArgs)
  })

  it('registers all public profile and road-report GET routes', async () => {
    const avatarResponse = await fetch(`${baseUrl}/profile/avatar/user-1`)
    expect(avatarResponse.status).toBe(200)
    expect(avatarResponse.headers.get('content-type')).toBe('image/webp')
    expect(profile.readAvatar).toHaveBeenCalledWith('user-1')

    const imageResponse = await fetch(`${baseUrl}/road-report-images/11111111-1111-4111-8111-111111111111`)
    expect(imageResponse.status).toBe(200)
    expect(imageResponse.headers.get('etag')).toBe('etag')
    expect(reports.image).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')

    const nearbyResponse = await fetch(`${baseUrl}/road-reports?north=-6&south=-7&east=107&west=106`)
    expect(await json(nearbyResponse)).toEqual({ status: 200, body: { data: [{ id: 'report-1' }] } })
    expect(reports.nearby).toHaveBeenCalledWith({ north: -6, south: -7, east: 107, west: 106 }, null)
    expect(getSession).toHaveBeenCalledTimes(1)
  })

  it('requires authentication and persists route comparisons for the session user', async () => {
    const anonymous = await fetch(`${baseUrl}/route-comparisons`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validComparison) })
    expect((await json(anonymous)).status).toBe(401)
    getSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    const authenticated = await fetch(`${baseUrl}/route-comparisons`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validComparison) })
    expect(await json(authenticated)).toEqual({ status: 200, body: { data: { comparisonId: 'comparison-1', routes: [{ id: 'route-1' }] }, stats: { routeCount: 1 } } })
    expect(comparisons.compare).toHaveBeenCalledWith(expect.objectContaining({ ...validComparison, accessibilityMode: 'STANDARD', departureOffsetsMinutes: [0, 30, 60], hazardPolicy: 'PREFER_FEWER_REPORTS', includeRestStops: true }), 'user-1')
  })

  it('requires authentication and serves place photos with secure headers', async () => {
    const anonymous = await fetch(`${baseUrl}/place-photos?name=${encodeURIComponent('places/place_1/photos/photo_1')}`)
    expect((await json(anonymous)).status).toBe(401)
    expect(comparisons.photo).not.toHaveBeenCalled()
    getSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    const authenticated = await fetch(`${baseUrl}/place-photos?name=${encodeURIComponent('places/place_1/photos/photo_1')}`)
    expect(authenticated.status).toBe(200)
    expect(authenticated.headers.get('content-type')).toBe('image/jpeg')
    expect(authenticated.headers.get('cache-control')).toBe('private, no-store')
    expect(authenticated.headers.get('x-content-type-options')).toBe('nosniff')
    expect(authenticated.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    expect(Buffer.from(await authenticated.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]))
    expect(comparisons.photo).toHaveBeenCalledWith('places/place_1/photos/photo_1')
  })

  it('authenticates, validates, and envelopes on-demand transit stop details without comparison access', async () => {
    const body = { name: '  Central Station  ', latitude: -6.2, longitude: 106.8 }
    const anonymous = await fetch(`${baseUrl}/transit-stop-details`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    expect((await json(anonymous)).status).toBe(401)
    expect(transitStopDetails).not.toHaveBeenCalled()
    getSession.mockResolvedValue({ user: { id: 'details-user' } } as never)
    transitStopDetails.mockResolvedValueOnce({ status: 'AVAILABLE', place: { id: 'station', name: 'Central Station', location: { latitude: -6.2, longitude: 106.8 }, types: ['train_station'], safetyVerified: false } })
    const authenticated = await fetch(`${baseUrl}/transit-stop-details`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    expect(authenticated.headers.get('cache-control')).toBe('private, no-store')
    expect(await json(authenticated)).toEqual({ status: 200, body: { data: { status: 'AVAILABLE', place: { id: 'station', name: 'Central Station', location: { latitude: -6.2, longitude: 106.8 }, types: ['train_station'], safetyVerified: false } } } })
    expect(transitStopDetails).toHaveBeenCalledWith({ name: 'Central Station', latitude: -6.2, longitude: 106.8 }, 'details-user')
    expect(comparisons.compare).not.toHaveBeenCalled()
  })

  it('rejects transit stop client options and enforces the thirty-request boundary', async () => {
    getSession.mockResolvedValue({ user: { id: 'boundary-user' } } as never)
    const invalid = await fetch(`${baseUrl}/transit-stop-details`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Central', latitude: 1, longitude: 2, radius: 500 }) })
    expect((await json(invalid)).status).toBe(400)
    for (let count = 0; count < 30; count += 1) expect((await fetch(`${baseUrl}/transit-stop-details`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Central', latitude: 1, longitude: 2 }) })).status).toBe(200)
    const limited = await fetch(`${baseUrl}/transit-stop-details`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Central', latitude: 1, longitude: 2 }) })
    expect(await json(limited)).toEqual({ status: 429, body: { error: { code: 'transit_stop_details_rate_limited', message: 'You can request up to 30 transit stop details every 5 minutes.', retryable: false } } })
  })
})

describe('route authentication boundaries', () => {
  it('allows authenticated profile PUT/DELETE and road-report POST', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } } as never)

    const avatarForm = new FormData()
    avatarForm.append('avatar', new Blob(['avatar'], { type: 'image/jpeg' }), 'avatar.jpg')
    expect((await fetch(`${baseUrl}/profile/avatar`, { method: 'PUT', body: avatarForm })).status).toBe(200)
    expect(profile.uploadAvatar).toHaveBeenCalledWith('user-1', expect.objectContaining({ mimetype: 'image/jpeg', fieldname: 'avatar' }))

    expect((await fetch(`${baseUrl}/profile/avatar`, { method: 'DELETE' })).status).toBe(200)
    expect(profile.removeAvatar).toHaveBeenCalledWith('user-1')

    const reportForm = new FormData()
    reportForm.append('category', 'HAZARD')
    reportForm.append('description', 'A meaningful hazard')
    reportForm.append('latitude', '-6.2')
    reportForm.append('longitude', '106.8')
    reportForm.append('images', new Blob(['image'], { type: 'image/png' }), 'road.png')
    expect((await fetch(`${baseUrl}/road-reports`, { method: 'POST', body: reportForm })).status).toBe(201)
    expect(reports.create).toHaveBeenCalledWith('user-1', expect.objectContaining({ category: 'HAZARD', latitude: -6.2 }), [expect.objectContaining({ mimetype: 'image/png' })])
  })

  it('registers authenticated report trust, commute watch, and trip impact routes', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    const reportId = '11111111-1111-4111-8111-111111111111'
    expect((await fetch(`${baseUrl}/road-reports/mine`)).status).toBe(200)
    expect((await fetch(`${baseUrl}/road-reports/${reportId}/verification`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict: 'CONFIRM' }) })).status).toBe(200)
    expect((await fetch(`${baseUrl}/road-reports/${reportId}/verification`, { method: 'DELETE' })).status).toBe(200)
    expect((await fetch(`${baseUrl}/road-reports/${reportId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'RESOLVED' }) })).status).toBe(200)

    const commute = { name: 'Morning', origin: { label: 'Home', ...validComparison.origin }, destination: { label: 'Office', ...validComparison.destination }, mode: 'WALK', preference: 'balanced' }
    expect((await fetch(`${baseUrl}/saved-commutes`)).status).toBe(200)
    expect((await fetch(`${baseUrl}/saved-commutes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(commute) })).status).toBe(201)
    expect((await fetch(`${baseUrl}/saved-commutes/${reportId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ watchEnabled: false }) })).status).toBe(200)
    expect((await fetch(`${baseUrl}/saved-commutes/${reportId}`, { method: 'DELETE' })).status).toBe(200)

    const trip = { routeResultId: '22222222-2222-4222-8222-222222222222' }
    expect((await fetch(`${baseUrl}/trip-impacts`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trip) })).status).toBe(201)
    expect((await fetch(`${baseUrl}/trip-impacts/summary`)).status).toBe(200)
    expect(reports.verify).toHaveBeenCalledWith(reportId, 'user-1', 'CONFIRM')
    expect(insights.createSavedCommute).toHaveBeenCalledWith('user-1', expect.objectContaining({ watchEnabled: true, watchHour: null }))
    expect(insights.recordTripImpact).toHaveBeenCalledWith('user-1', trip)
  })

  it.each([
    ['POST', '/route-comparisons'],
    ['POST', '/transit-stop-details'],
    ['PUT', '/profile/avatar'],
    ['DELETE', '/profile/avatar'],
    ['POST', '/road-reports'],
    ['GET', '/road-reports/mine'],
    ['PUT', '/road-reports/11111111-1111-4111-8111-111111111111/verification'],
    ['DELETE', '/road-reports/11111111-1111-4111-8111-111111111111/verification'],
    ['PATCH', '/road-reports/11111111-1111-4111-8111-111111111111'],
    ['GET', '/saved-commutes'],
    ['POST', '/saved-commutes'],
    ['PATCH', '/saved-commutes/11111111-1111-4111-8111-111111111111'],
    ['DELETE', '/saved-commutes/11111111-1111-4111-8111-111111111111'],
    ['POST', '/trip-impacts'],
    ['GET', '/trip-impacts/summary'],
    ['GET', '/place-photos?name=places%2Fplace_1%2Fphotos%2Fphoto_1'],
  ])('rejects anonymous %s %s before controllers and multipart parsing', async (method, path) => {
    const response = await fetch(baseUrl + path, { method })
    expect(await json(response)).toEqual({ status: 401, body: { error: { code: 'authentication_required', message: 'Sign in to continue.', retryable: false } } })
    expect(profile.uploadAvatar).not.toHaveBeenCalled()
    expect(profile.removeAvatar).not.toHaveBeenCalled()
    expect(reports.create).not.toHaveBeenCalled()
  })
})

describe('OpenAPI runtime contracts', () => {
  it('documents persisted route identifiers and secure trip impact input only', () => {
    const schemas = (openApiDocument.components as { schemas: Record<string, { required?: string[]; properties?: Record<string, unknown>; additionalProperties?: boolean }> }).schemas
    expect(schemas.RouteComparison.required).toEqual(expect.arrayContaining(['comparisonId', 'persisted', 'routes', 'departureComparisons', 'cleanestDeparture']))
    expect(schemas.RouteOption.required).toEqual(expect.arrayContaining(['hazardSummary', 'confidence', 'explanation', 'heatUv', 'weatherConditions', 'accessibility']))
    expect(schemas.RouteOption.properties).toHaveProperty('routeResultId')
    expect(schemas.RouteOption.properties).toHaveProperty('transitSummary')
    expect(schemas.TransitSegment).toMatchObject({ required: ['travelMode'], properties: { travelMode: { type: 'string' }, durationSeconds: { type: 'number', minimum: 0 }, distanceMeters: { type: 'number', minimum: 0 } } })
    expect(schemas.AccessPlan).toMatchObject({ additionalProperties: false, required: ['firstMileMode', 'lastMileMode', 'bicyclePlan'], properties: { firstMileMode: { const: 'BICYCLE' }, lastMileMode: { const: 'WALK' }, bicyclePlan: { const: 'PARK_AT_FIRST_TRANSIT_STOP' } } })
    expect(schemas.RouteComparisonRequest).toMatchObject({ additionalProperties: false, properties: { accessPlan: { $ref: '#/components/schemas/AccessPlan' } } })
    expect(schemas.RouteOption.properties).toMatchObject({ composition: { const: 'PROVIDER_SEGMENTS' }, scheduleStatus: { const: 'SCHEDULE_VALIDATED' }, limitations: { type: 'array' } })
    expect(schemas.RouteComparison).toMatchObject({ allOf: expect.arrayContaining([{ if: { properties: { persisted: { const: false } } }, then: { properties: { routes: { items: { not: { required: ['routeResultId'] } } } } } }]) })
    expect(schemas.CompositeTransitSegment).toMatchObject({ required: expect.arrayContaining(['role', 'source', 'mode', 'durationSeconds', 'distanceMeters']), properties: { role: { enum: ['FIRST_MILE', 'WAIT', 'TRANSIT_RIDE', 'TRANSFER_WALK', 'LAST_MILE'] }, source: { enum: ['GOOGLE_ROUTES', 'DERIVED_FROM_TRANSIT_SCHEDULE'] } } })
    expect(schemas.BikeTransitUnavailableError).toMatchObject({ properties: { error: { properties: { code: { const: 'bike_transit_unavailable' }, retryable: { const: false } } } } })
    expect(schemas.PlacePhoto.properties).toMatchObject({ googleMapsUri: { type: 'string', format: 'uri' }, flagContentUri: { type: 'string', format: 'uri' }, authorAttributions: { items: { required: ['displayName'], properties: { uri: { type: 'string', format: 'uri' }, photoUri: { type: 'string', format: 'uri' } } } } })
    expect(schemas.RestStopCandidate.properties).toMatchObject({ associationId: { type: 'string', format: 'uuid' }, photos: { type: 'array', maxItems: 3, items: { $ref: '#/components/schemas/PlacePhoto' } } })
    expect(schemas.RestStopCandidate.properties).not.toHaveProperty('photo')
    expect(schemas.HazardSummary.required).toContain('fewerConfirmedReportSignals')
    expect((schemas.ReportEvidence.properties?.evidence as { properties: { factors: { required: string[]; properties: Record<string, unknown> } } }).properties.factors).toMatchObject({ required: ['recency', 'photos', 'voteBalance'], properties: { voteBalance: { type: 'integer', minimum: 0, maximum: 30 } } })
    expect((schemas.ReportEvidence.properties?.evidence as { properties: { factors: { properties: Record<string, unknown> } } }).properties.factors.properties).not.toHaveProperty('confirmationBalance')
    expect(schemas.HazardSummary.required).not.toContain('hazardsAvoided')
    expect(schemas.HazardSummary.properties).not.toHaveProperty('hazardsAvoided')
    expect(schemas.TripImpactInput).toMatchObject({ additionalProperties: false, required: ['routeResultId'] })
    expect(Object.keys(schemas.TripImpactInput.properties ?? {})).toEqual(['routeResultId'])
    expect((openApiDocument.paths as Record<string, { post?: { security?: unknown } }>)['/api/v1/trip-impacts'].post?.security).toEqual([{ cookieAuth: [] }])
    expect((openApiDocument.paths as Record<string, { post?: { security?: unknown } }>)['/api/v1/route-comparisons'].post?.security).toEqual([{ cookieAuth: [] }])
    const photo = (openApiDocument.paths as Record<string, { get?: { security?: unknown; parameters?: unknown[]; responses?: Record<string, unknown> } }>)[API_ENDPOINTS.placePhotos].get
    expect(photo?.security).toEqual([{ cookieAuth: [] }])
    expect(photo?.parameters).toEqual([{ name: 'name', in: 'query', required: true, schema: { type: 'string', pattern: '^places/[A-Za-z0-9_-]{1,256}/photos/[A-Za-z0-9_-]{1,512}$', maxLength: 783 } }])
    expect(Object.keys(photo?.responses ?? {})).toEqual(['200', '400', '401', '404', '429', '502', '503'])
    const details = (openApiDocument.paths as Record<string, { post?: { security?: unknown; requestBody?: unknown; responses?: Record<string, unknown> } }>)[API_ENDPOINTS.transitStopDetails].post
    expect(details?.security).toEqual([{ cookieAuth: [] }])
    expect(details?.requestBody).toEqual({ required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/TransitStopDetailsRequest' } } } })
    expect(Object.keys(details?.responses ?? {})).toEqual(['200', '400', '401', '404', '429', '502', '503'])
    expect((details?.responses as Record<string, unknown>)['200']).toMatchObject({ headers: { 'Cache-Control': { schema: { type: 'string', const: 'private, no-store' } } } })
    expect(schemas.TransitStopDetailsRequest).toMatchObject({ additionalProperties: false, required: ['name', 'latitude', 'longitude'], allOf: [{ if: { anyOf: [{ required: ['routeResultId'] }, { required: ['ordinal'] }, { required: ['role'] }] }, then: { required: ['routeResultId', 'ordinal', 'role'] } }], properties: { name: { type: 'string', minLength: 1, maxLength: 160, pattern: expect.any(String) }, latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 }, routeResultId: { type: 'string', format: 'uuid' }, ordinal: { type: 'integer', minimum: 0, maximum: 99 }, role: { type: 'string', enum: ['departure', 'arrival'] } } })
    expect(schemas.TransitStopDetailsResult).toMatchObject({ oneOf: expect.arrayContaining([expect.objectContaining({ required: ['status', 'place'] }), expect.objectContaining({ required: ['status'] })]) })
  })
})

describe('route validation, error propagation, and multipart policy', () => {
  it('formats real controller validation and AppError failures centrally', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    const invalidComparison = await fetch(`${baseUrl}/route-comparisons`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...validComparison, mode: 'CAR' }) })
    expect((await json(invalidComparison)).body).toMatchObject({ error: { code: 'validation_error', fields: { mode: expect.any(String) } } })
    expect(comparisons.compare).not.toHaveBeenCalled()

    const invalidBounds = await fetch(`${baseUrl}/road-reports?north=0&south=0&east=1&west=0`)
    expect((await json(invalidBounds)).body).toMatchObject({ error: { code: 'validation_error', fields: { north: 'North must be greater than south.' } } })
    expect(reports.nearby).not.toHaveBeenCalled()

    recovery.read.mockRejectedValue(new AppError(404, 'recovery_not_found', 'This recovery request is invalid or expired.', false))
    const propagated = await fetch(`${baseUrl}/recovery-challenges/missing`)
    expect(await json(propagated)).toEqual({ status: 404, body: { error: { code: 'recovery_not_found', message: 'This recovery request is invalid or expired.', retryable: false } } })
  })

  it.each([
    ['PUT', '/profile/avatar', 'avatar', 'text/plain', 'avatar_type_invalid'],
    ['POST', '/road-reports', 'images', 'text/plain', 'report_image_type_invalid'],
  ])('rejects unsupported multipart MIME for %s %s', async (method, path, field, mime, code) => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    const form = new FormData()
    form.append(field, new Blob(['not an image'], { type: mime }), 'bad.txt')
    const response = await fetch(baseUrl + path, { method, body: form })
    expect((await json(response)).body).toMatchObject({ error: { code } })
  })

  it('enforces the three-image multipart count before the road-report controller', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    const form = new FormData()
    for (let index = 0; index < 4; index += 1) form.append('images', new Blob([String(index)], { type: 'image/jpeg' }), `${index}.jpg`)
    const response = await fetch(`${baseUrl}/road-reports`, { method: 'POST', body: form })
    expect(await json(response)).toEqual({ status: 400, body: { error: { code: 'report_image_limit', message: 'Attach no more than 3 images.', retryable: false } } })
    expect(reports.create).not.toHaveBeenCalled()
  })
})
