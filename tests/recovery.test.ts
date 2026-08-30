jest.mock('../src/config/auth', () => ({
  auth: { api: { requestPasswordResetEmailOTP: jest.fn(), checkVerificationOTP: jest.fn(), resetPasswordEmailOTP: jest.fn() } },
}))
jest.mock('../src/middleware/index.js', () => jest.requireActual('../src/middleware/errors'))

import { auth } from '../src/config/auth'
import { AppError, errorHandler } from '../src/middleware/errors'
import { RecoveryController } from '../src/modules/recovery/recovery.controller'
import type { RecoveryRepository } from '../src/modules/recovery/recovery.repository'
import { RecoveryService } from '../src/modules/recovery/recovery.service'
import { next, request, response } from './helpers'

const challengeId = 'a'.repeat(43)
const nextChallengeId = 'b'.repeat(43)
const expiresAt = new Date('2026-08-30T12:05:00.000Z')
const authApi = auth.api as jest.Mocked<typeof auth.api>

function repository() {
  return {
    create: jest.fn(),
    find: jest.fn(),
    consume: jest.fn(),
    removeExpired: jest.fn(),
  } as unknown as jest.Mocked<RecoveryRepository>
}

function expectAppError(promise: Promise<unknown>, statusCode: number, code: string) {
  return expect(promise).rejects.toMatchObject({ statusCode, code })
}

describe('recovery challenge service', () => {
  beforeEach(() => jest.resetAllMocks())

  it('creates a normalized challenge after cleanup and asks Better Auth to send OTP', async () => {
    const repo = repository()
    repo.create.mockResolvedValue(challengeId)
    const headers = new Headers({ 'user-agent': 'jest' })
    await expect(new RecoveryService(repo).request('  Person@Example.COM ', headers)).resolves.toEqual({ id: challengeId, expiresInSeconds: 300 })
    expect(repo.removeExpired.mock.invocationCallOrder[0]).toBeLessThan(repo.create.mock.invocationCallOrder[0])
    expect(repo.create).toHaveBeenCalledWith('person@example.com')
    expect(authApi.requestPasswordResetEmailOTP).toHaveBeenCalledWith({ body: { email: 'person@example.com' }, headers })
  })

  it.each([undefined, 'bad', 'x@'])('rejects invalid request email %p before persistence', async (email) => {
    const repo = repository()
    await expectAppError(new RecoveryService(repo).request(email), 400, 'email_invalid')
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('propagates cleanup, repository, and OTP provider failures', async () => {
    const cleanupRepo = repository()
    cleanupRepo.removeExpired.mockRejectedValue(new Error('db'))
    await expect(new RecoveryService(cleanupRepo).request('a@example.com')).rejects.toThrow('db')

    const createRepo = repository()
    createRepo.create.mockRejectedValue(new Error('db create'))
    await expect(new RecoveryService(createRepo).request('a@example.com')).rejects.toThrow('db create')

    const providerRepo = repository()
    providerRepo.create.mockResolvedValue(challengeId)
    authApi.requestPasswordResetEmailOTP.mockRejectedValueOnce(new Error('smtp'))
    await expect(new RecoveryService(providerRepo).request('a@example.com')).rejects.toThrow('smtp')
  })

  it('rotates a valid challenge and consumes the old one only after OTP dispatch', async () => {
    const repo = repository()
    repo.find.mockResolvedValue({ email: 'person@example.com', expiresAt })
    repo.create.mockResolvedValue(nextChallengeId)
    await expect(new RecoveryService(repo).resend(challengeId)).resolves.toEqual({ id: nextChallengeId, expiresInSeconds: 300 })
    expect(repo.consume).toHaveBeenCalledWith(challengeId)
    expect(authApi.requestPasswordResetEmailOTP).toHaveBeenCalledWith({ body: { email: 'person@example.com' }, headers: undefined })
  })

  it('does not consume the old challenge when resend delivery fails', async () => {
    const repo = repository()
    repo.find.mockResolvedValue({ email: 'person@example.com', expiresAt })
    repo.create.mockResolvedValue(nextChallengeId)
    authApi.requestPasswordResetEmailOTP.mockRejectedValue(new Error('smtp'))
    await expect(new RecoveryService(repo).resend(challengeId)).rejects.toThrow('smtp')
    expect(repo.consume).not.toHaveBeenCalled()
  })

  it.each(['short', challengeId])('rejects invalid or missing resend challenge', async (id) => {
    const repo = repository()
    repo.find.mockResolvedValue(null)
    await expectAppError(new RecoveryService(repo).resend(id), 400, 'recovery_invalid')
  })

  it('reads and serializes a masked challenge status', async () => {
    const repo = repository()
    repo.find.mockResolvedValue({ email: 'alice@example.com', expiresAt })
    await expect(new RecoveryService(repo).read(challengeId)).resolves.toEqual({ maskedEmail: 'al***@example.com', expiresAt: expiresAt.toISOString() })
  })

  it('uses a safe fallback mask and 404 semantics for read boundaries', async () => {
    const repo = repository()
    repo.find.mockResolvedValueOnce({ email: 'malformed', expiresAt }).mockResolvedValueOnce(null)
    await expect(new RecoveryService(repo).read(challengeId)).resolves.toMatchObject({ maskedEmail: 'your email' })
    await expectAppError(new RecoveryService(repo).read(challengeId), 404, 'recovery_not_found')
    await expectAppError(new RecoveryService(repo).read('invalid'), 404, 'recovery_not_found')
  })

  it('verifies a six-digit OTP through Better Auth', async () => {
    const repo = repository()
    repo.find.mockResolvedValue({ email: 'person@example.com', expiresAt })
    await expect(new RecoveryService(repo).verify(challengeId, '123456')).resolves.toEqual({ verified: true })
    expect(authApi.checkVerificationOTP).toHaveBeenCalledWith({ body: { email: 'person@example.com', otp: '123456', type: 'forget-password' } })
  })

  it.each([
    ['invalid', '123456'],
    [challengeId, '12345'],
    [challengeId, 123456],
  ])('rejects malformed verification input', async (id, otp) => {
    const repo = repository()
    await expectAppError(new RecoveryService(repo).verify(id, otp), 400, 'recovery_invalid')
    expect(repo.find).not.toHaveBeenCalled()
  })

  it('normalizes missing challenge and Better Auth verification failures', async () => {
    const missingRepo = repository()
    missingRepo.find.mockResolvedValue(null)
    await expectAppError(new RecoveryService(missingRepo).verify(challengeId, '123456'), 400, 'recovery_invalid')

    const repo = repository()
    repo.find.mockResolvedValue({ email: 'person@example.com', expiresAt })
    authApi.checkVerificationOTP.mockRejectedValue(new Error('attempts exhausted'))
    await expectAppError(new RecoveryService(repo).verify(challengeId, '123456'), 400, 'recovery_invalid')
  })

  it('resets the password then consumes the challenge', async () => {
    const repo = repository()
    repo.find.mockResolvedValue({ email: 'person@example.com', expiresAt })
    await expect(new RecoveryService(repo).reset(challengeId, '123456', 'password8')).resolves.toEqual({ success: true })
    expect(authApi.resetPasswordEmailOTP).toHaveBeenCalledWith({ body: { email: 'person@example.com', otp: '123456', password: 'password8' } })
    expect(repo.consume).toHaveBeenCalledWith(challengeId)
  })

  it.each([
    ['invalid', '123456', 'password8'],
    [challengeId, 'bad', 'password8'],
    [challengeId, '123456', 'short'],
    [challengeId, '123456', 'x'.repeat(129)],
  ])('rejects malformed reset input', async (id, otp, password) => {
    const repo = repository()
    await expectAppError(new RecoveryService(repo).reset(id, otp, password), 400, 'recovery_invalid')
    expect(repo.find).not.toHaveBeenCalled()
  })

  it('does not consume when reset provider fails and rejects missing challenges', async () => {
    const missingRepo = repository()
    missingRepo.find.mockResolvedValue(null)
    await expectAppError(new RecoveryService(missingRepo).reset(challengeId, '123456', 'password8'), 400, 'recovery_invalid')

    const repo = repository()
    repo.find.mockResolvedValue({ email: 'person@example.com', expiresAt })
    authApi.resetPasswordEmailOTP.mockRejectedValue(new Error('invalid OTP'))
    await expectAppError(new RecoveryService(repo).reset(challengeId, '123456', 'password8'), 400, 'recovery_invalid')
    expect(repo.consume).not.toHaveBeenCalled()
  })
})

describe('five recovery endpoint controllers', () => {
  it.each([
    ['request', { body: { email: 'a@example.com' }, headers: { host: 'api' } }, ['a@example.com', expect.any(Headers)], { id: challengeId }, 200],
    ['read', { params: { id: challengeId } }, [challengeId], { maskedEmail: 'a***@example.com' }, 200],
    ['resend', { params: { id: challengeId }, headers: { host: 'api' } }, [challengeId, expect.any(Headers)], { id: nextChallengeId }, 200],
    ['verify', { params: { id: challengeId }, body: { otp: '123456' } }, [challengeId, '123456'], { verified: true }, 200],
    ['reset', { params: { id: challengeId }, body: { otp: '123456', password: 'password8' } }, [challengeId, '123456', 'password8'], { success: true }, 200],
  ] as const)('%s serializes its service result', async (method, req, args, result, status) => {
    const service = { [method]: jest.fn().mockResolvedValue(result) }
    const controller = new RecoveryController(service as never)
    const res = response()
    await controller[method](request(req), res, next())
    expect(service[method]).toHaveBeenCalledWith(...args)
    expect(res.status).toHaveBeenCalledWith(status)
    expect(res.json).toHaveBeenCalledWith({ data: result })
  })

  it('passes a real AppError through the central error handler', async () => {
    const failure = new AppError(400, 'email_invalid', 'Enter a valid email address.')
    const controller = new RecoveryController({ request: jest.fn().mockRejectedValue(failure) } as never)
    let caught: unknown
    try { await controller.request(request(), response(), next()) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(AppError)
    const res = response()
    errorHandler(caught, request({ path: '/api/v1/recovery-challenges' }), res, next())
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'email_invalid', message: 'Enter a valid email address.', retryable: false } })
  })
})
