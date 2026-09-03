jest.mock('../src/config/index', () => ({
  auth: { api: { getSession: jest.fn() } },
}))

import multer from 'multer'
import { z } from 'zod'
import { healthHandler } from '../src/config/health'
import { auth } from '../src/config/index'
import { authMiddleware } from '../src/middleware/authMiddleware'
import { AppError, errorHandler, notFoundHandler } from '../src/middleware/errors'
import { next, request, response } from './helpers'

const getSession = jest.mocked(auth.api.getSession)

describe('GET /api/health', () => {
  it('returns the service health envelope', () => {
    const res = response()
    healthHandler(request(), res, next())
    expect(res.json).toHaveBeenCalledWith({ data: { status: 'ok', service: 'aeroute-api' } })
  })
})

describe('authMiddleware', () => {
  beforeEach(() => jest.clearAllMocks())

  it('stores the authenticated user and continues', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } } as never)
    const res = response()
    const done = next()
    await authMiddleware(request({ headers: { cookie: 'session=x' } }), res, done)
    expect(res.locals.userId).toBe('user-1')
    expect(done).toHaveBeenCalledWith()
  })

  it.each([null, { user: { id: '' } }])('rejects a missing user session', async (session) => {
    getSession.mockResolvedValue(session as never)
    const done = next()
    await authMiddleware(request(), response(), done)
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401, code: 'authentication_required', retryable: false }))
  })

  it('propagates Better Auth failures', async () => {
    const failure = new Error('auth unavailable')
    getSession.mockRejectedValue(failure)
    await expect(authMiddleware(request(), response(), next())).rejects.toBe(failure)
  })
})

describe('central error formatting', () => {
  const run = (error: unknown, path = '/') => {
    const res = response()
    errorHandler(error, request({ path }), res, next())
    return res
  }

  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined))
  afterEach(() => jest.restoreAllMocks())

  it('formats AppError without logging it', () => {
    const res = run(new AppError(422, 'bad_trip', 'Bad trip.', false))
    expect(res.status).toHaveBeenCalledWith(422)
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'bad_trip', message: 'Bad trip.', retryable: false } })
    expect(console.error).not.toHaveBeenCalled()
  })

  it('formats Zod fields by path', () => {
    let error: unknown
    try { z.object({ email: z.email() }).parse({ email: 'nope' }) } catch (caught) { error = caught }
    const res = run(error)
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'validation_error', message: 'Check the submitted details.', retryable: false, fields: { email: expect.any(String) } } })
  })

  it.each([
    ['LIMIT_FILE_SIZE', '/road-reports', 413, 'report_image_too_large', 'Each report image must be 3 MB or smaller.'],
    ['LIMIT_FILE_SIZE', '/profile/avatar', 413, 'avatar_too_large', 'Profile photo must be 5 MB or smaller.'],
    ['LIMIT_FILE_COUNT', '/road-reports', 400, 'report_image_limit', 'Attach no more than 3 images.'],
    ['LIMIT_FILE_COUNT', '/profile/avatar', 400, 'avatar_file_limit', 'Upload one profile photo at a time.'],
    ['LIMIT_FIELD_COUNT', '/profile/avatar', 400, 'avatar_multipart_invalid', 'Profile photo request could not be read.'],
    ['LIMIT_FIELD_COUNT', '/other', 400, 'upload_invalid', 'Image upload is invalid.'],
  ])('maps Multer %s errors for %s', (code, path, status, responseCode, message) => {
    const res = run(new multer.MulterError(code as multer.ErrorCode), path)
    expect(res.locals.uploadErrorCode).toBe(code)
    expect(res.status).toHaveBeenCalledWith(status)
    expect(res.json).toHaveBeenCalledWith({ error: { code: responseCode, message, retryable: false } })
  })

  it.each(['P1001', 'P1002', 'P1008', 'P2021'])('maps Prisma %s readiness failures', (code) => {
    const res = run(Object.assign(new Error('db'), { code }))
    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'database_unavailable', message: 'The service database is not ready.', retryable: true } })
  })

  it('hides and logs unknown errors', () => {
    const res = run(new Error('secret failure'), '/api/v1/example')
    expect(console.error).toHaveBeenCalledWith('Request failed', expect.objectContaining({ path: '/api/v1/example', message: 'secret failure' }))
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'internal_error', message: 'An unexpected server error occurred.', retryable: true } })
  })

  it('turns unmatched endpoints into a not-found AppError', () => {
    const done = next()
    notFoundHandler(request(), response(), done)
    expect(done).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404, code: 'not_found' }))
  })
})
