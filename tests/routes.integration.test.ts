jest.mock('../src/config/index.js', () => ({ auth: { api: { getSession: jest.fn() } } }))

import express from 'express'
import type { Server } from 'node:http'
import { auth } from '../src/config/index'
import { AppError, errorHandler } from '../src/middleware/errors'
import { ProfileController } from '../src/modules/profile/profile.controller'
import createProfileRoutes from '../src/modules/profile/profile.routes'
import { RecoveryController } from '../src/modules/recovery/recovery.controller'
import createRecoveryRoutes from '../src/modules/recovery/recovery.routes'
import { RoadReportController } from '../src/modules/road-report/road-report.controller'
import createRoadReportRoutes from '../src/modules/road-report/road-report.routes'
import { RouteComparisonController } from '../src/modules/route-comparison/route-comparison.controller'
import createRouteComparisonRoutes from '../src/modules/route-comparison/route-comparison.routes'

const getSession = jest.mocked(auth.api.getSession)
const recovery = {
  request: jest.fn(), read: jest.fn(), resend: jest.fn(), verify: jest.fn(), reset: jest.fn(),
}
const profile = { readAvatar: jest.fn(), uploadAvatar: jest.fn(), removeAvatar: jest.fn() }
const reports = { image: jest.fn(), nearby: jest.fn(), create: jest.fn() }
const comparisons = { compare: jest.fn() }
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
  app.use('/api/v1', createProfileRoutes(new ProfileController(profile as never)))
  app.use('/api/v1', createRoadReportRoutes(new RoadReportController(reports as never)))
  app.use('/api/v1', createRouteComparisonRoutes(new RouteComparisonController(comparisons as never)))
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
  reports.create.mockResolvedValue({ id: 'report-1' })
  comparisons.compare.mockResolvedValue({ comparisonId: 'comparison-1', routes: [{ id: 'route-1' }] })
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
    expect(reports.nearby).toHaveBeenCalledWith({ north: -6, south: -7, east: 107, west: 106 })
  })

  it('registers anonymous route comparisons and passes the session boundary', async () => {
    const response = await fetch(`${baseUrl}/route-comparisons`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validComparison) })
    expect(await json(response)).toEqual({ status: 200, body: { data: { comparisonId: 'comparison-1', routes: [{ id: 'route-1' }] }, stats: { routeCount: 1 } } })
    expect(comparisons.compare).toHaveBeenCalledWith(validComparison, null)
    expect(getSession).toHaveBeenCalledTimes(1)
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

  it.each([
    ['PUT', '/profile/avatar'],
    ['DELETE', '/profile/avatar'],
    ['POST', '/road-reports'],
  ])('rejects anonymous %s %s before controllers and multipart parsing', async (method, path) => {
    const response = await fetch(baseUrl + path, { method })
    expect(await json(response)).toEqual({ status: 401, body: { error: { code: 'authentication_required', message: 'Sign in to continue.', retryable: false } } })
    expect(profile.uploadAvatar).not.toHaveBeenCalled()
    expect(profile.removeAvatar).not.toHaveBeenCalled()
    expect(reports.create).not.toHaveBeenCalled()
  })
})

describe('route validation, error propagation, and multipart policy', () => {
  it('formats real controller validation and AppError failures centrally', async () => {
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
