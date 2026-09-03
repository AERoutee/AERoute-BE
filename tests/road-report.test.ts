jest.mock('sharp', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../src/middleware/index.js', () => jest.requireActual('../src/middleware/errors'))
jest.mock('../src/config/index.js', () => ({ auth: { api: { getSession: jest.fn() } } }))
jest.mock('../src/modules/road-report/providers/index.js', () => ({
  putRoadReportImage: jest.fn(),
  getRoadReportImage: jest.fn(),
  deleteRoadReportImage: jest.fn(),
}))

import sharp from 'sharp'
import { auth } from '../src/config/index'
import { AppError, errorHandler } from '../src/middleware/errors'
import { RoadReportController } from '../src/modules/road-report/road-report.controller'
import { RoadReportRepository } from '../src/modules/road-report/road-report.repository'
import { RoadReportService } from '../src/modules/road-report/road-report.service'
import { deleteRoadReportImage, getRoadReportImage, putRoadReportImage } from '../src/modules/road-report/providers'
import { createRoadReportSchema, nearbyRoadReportsSchema } from '../src/modules/road-report/road-report.validation'
import { file, next, request, response } from './helpers'

const sharpMock = jest.mocked(sharp)
const putMock = jest.mocked(putRoadReportImage)
const getMock = jest.mocked(getRoadReportImage)
const deleteMock = jest.mocked(deleteRoadReportImage)
const createdAt = new Date('2026-08-30T10:00:00.000Z')
const expiresAt = new Date('2026-08-31T10:00:00.000Z')

function repository() {
  return {
    countRecentByUser: jest.fn(),
    create: jest.fn(),
    findImage: jest.fn(),
    findNearby: jest.fn(),
    findMine: jest.fn(),
    findById: jest.fn(),
    verifyActive: jest.fn(),
    deleteVerification: jest.fn(),
    resolveActive: jest.fn(),
  } as unknown as jest.Mocked<RoadReportRepository>
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-1', category: 'HAZARD', description: 'A meaningful hazard', latitude: -6.2, longitude: 106.8,
    userId: 'user-1', resolvedAt: null, createdAt, expiresAt, images: [{ id: 'image-1' }], user: { name: 'Alice Example' }, verifications: [], ...overrides,
  } as never
}

function validSharp(width = 640, height = 480, outputWidth = 640, outputHeight = 480) {
  sharpMock
    .mockReturnValueOnce({ metadata: jest.fn().mockResolvedValue({ width, height }) } as never)
    .mockReturnValueOnce({
      autoOrient: jest.fn().mockReturnValue({
        resize: jest.fn().mockReturnValue({
          webp: jest.fn().mockReturnValue({ toBuffer: jest.fn().mockResolvedValue({ data: Buffer.from('webp'), info: { width: outputWidth, height: outputHeight } }) }),
        }),
      }),
    } as never)
}

const input = { category: 'HAZARD' as const, description: 'A meaningful hazard', latitude: -6.2, longitude: 106.8 }

describe('road report validation', () => {
  it('coerces multipart coordinates and trims descriptions', () => {
    expect(createRoadReportSchema.parse({ ...input, description: '  A meaningful hazard  ', latitude: '-6.2', longitude: '106.8' })).toEqual(input)
  })

  it.each([
    [{ ...input, category: 'OTHER' }],
    [{ ...input, description: 'short' }],
    [{ ...input, latitude: 91 }],
    [{ ...input, longitude: 181 }],
  ])('rejects invalid create input', (value) => expect(() => createRoadReportSchema.parse(value)).toThrow())

  it('accepts normal and antimeridian nearby bounds and rejects invalid size boundaries', () => {
    expect(nearbyRoadReportsSchema.parse({ north: '-6', south: '-7', east: '107', west: '106' })).toEqual({ north: -6, south: -7, east: 107, west: 106 })
    expect(nearbyRoadReportsSchema.parse({ north: 1, south: 0, east: -179, west: 179 })).toEqual({ north: 1, south: 0, east: -179, west: 179 })
    expect(() => nearbyRoadReportsSchema.parse({ north: 0, south: 0, east: 1, west: 0 })).toThrow('North must be greater than south.')
    expect(() => nearbyRoadReportsSchema.parse({ north: 1, south: 0, east: 0, west: 0 })).toThrow('East and west must differ.')
    expect(() => nearbyRoadReportsSchema.parse({ north: 3, south: 0, east: 3, west: 0 })).toThrow('Map area is too large.')
    expect(() => nearbyRoadReportsSchema.parse({ north: 1, south: 0, east: -178, west: 179 })).toThrow('Map area is too large.')
  })
})

describe('road report repository', () => {
  it('queries wrapped longitudes as either side of the antimeridian', async () => {
    const findMany = jest.fn().mockResolvedValue([])
    await new RoadReportRepository({ trRoadReport: { findMany } } as never).findNearby({ north: 1, south: 0, east: -179, west: 179 }, createdAt)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ longitude: { gte: 179 } }, { longitude: { lte: -179 } }] }) }))
  })
})

describe('road report service', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    jest.useFakeTimers().setSystemTime(new Date('2026-08-30T10:00:00.000Z'))
  })
  afterEach(() => jest.useRealTimers())

  it('rejects more than three files before repository access', async () => {
    const repo = repository()
    await expect(new RoadReportService(repo).create('user-1', input, [file(), file(), file(), file()])).rejects.toMatchObject({ statusCode: 400, code: 'report_image_limit' })
    expect(repo.countRecentByUser).not.toHaveBeenCalled()
  })

  it('enforces the five reports per ten-minute boundary', async () => {
    const repo = repository()
    repo.countRecentByUser.mockResolvedValue(5)
    await expect(new RoadReportService(repo).create('user-1', input, [])).rejects.toMatchObject({ statusCode: 429, code: 'report_rate_limited' })
    expect(repo.countRecentByUser).toHaveBeenCalledWith('user-1', new Date('2026-08-30T09:50:00.000Z'))
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('creates a report without optional images and serializes dates and reporter', async () => {
    const repo = repository()
    repo.countRecentByUser.mockResolvedValue(4)
    repo.create.mockResolvedValue(report())
    const result = await new RoadReportService(repo).create('user-1', input, [])
    expect(result).toMatchObject({
      id: 'report-1', category: 'HAZARD', description: input.description, latitude: -6.2, longitude: 106.8,
      createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), images: ['/api/v1/road-report-images/image-1'], reporter: 'Alice', status: 'ACTIVE', isOwner: true,
      verification: { confirmations: 0, disputes: 0, viewerVerdict: null }, evidence: { score: 50, level: 'MEDIUM', kind: 'EVIDENCE_SCORE' },
    })
    expect(result.evidence.factors).toEqual({ recency: 40, photos: 10, voteBalance: 0 })
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', images: [], expiresAt: new Date('2026-08-31T10:00:00.000Z') }))
  })

  it('processes and persists image metadata in input order', async () => {
    const repo = repository()
    repo.countRecentByUser.mockResolvedValue(0)
    repo.create.mockResolvedValue(report())
    validSharp(640, 480, 640, 480)
    validSharp(800, 600, 800, 600)
    putMock.mockResolvedValueOnce('https://cdn/one.webp').mockResolvedValueOnce('https://cdn/two.webp')
    await new RoadReportService(repo).create('user-1', input, [file(Buffer.from('one')), file(Buffer.from('two'))])
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ images: [
      expect.objectContaining({ imageUrl: 'https://cdn/one.webp', position: 0, width: 640, height: 480 }),
      expect.objectContaining({ imageUrl: 'https://cdn/two.webp', position: 1, width: 800, height: 600 }),
    ] }))
  })

  it('rejects corrupt and undersized images', async () => {
    const corruptRepo = repository()
    corruptRepo.countRecentByUser.mockResolvedValue(0)
    sharpMock.mockReturnValueOnce({ metadata: jest.fn().mockRejectedValue(new Error('corrupt')) } as never)
    await expect(new RoadReportService(corruptRepo).create('user-1', input, [file()])).rejects.toMatchObject({ code: 'report_image_invalid' })

    const smallRepo = repository()
    smallRepo.countRecentByUser.mockResolvedValue(0)
    validSharp(63, 64)
    await expect(new RoadReportService(smallRepo).create('user-1', input, [file()])).rejects.toMatchObject({ code: 'report_image_too_small' })
  })

  it('cleans uploaded objects when later processing or repository persistence fails', async () => {
    const processingRepo = repository()
    processingRepo.countRecentByUser.mockResolvedValue(0)
    validSharp()
    sharpMock.mockReturnValueOnce({ metadata: jest.fn().mockRejectedValue(new Error('bad second image')) } as never)
    putMock.mockResolvedValueOnce('https://cdn/one.webp')
    await expect(new RoadReportService(processingRepo).create('user-1', input, [file(), file()])).rejects.toMatchObject({ code: 'report_image_invalid' })
    expect(deleteMock).toHaveBeenCalledTimes(1)

    jest.clearAllMocks()
    const persistenceRepo = repository()
    persistenceRepo.countRecentByUser.mockResolvedValue(0)
    persistenceRepo.create.mockRejectedValue(new Error('db'))
    validSharp()
    putMock.mockResolvedValue('https://cdn/one.webp')
    await expect(new RoadReportService(persistenceRepo).create('user-1', input, [file()])).rejects.toThrow('db')
    expect(deleteMock).toHaveBeenCalledWith(expect.stringMatching(/^road-reports\//u))
  })

  it('propagates count and image-provider failures without persistence', async () => {
    const countRepo = repository()
    countRepo.countRecentByUser.mockRejectedValue(new Error('count db'))
    await expect(new RoadReportService(countRepo).create('user-1', input, [])).rejects.toThrow('count db')

    const uploadRepo = repository()
    uploadRepo.countRecentByUser.mockResolvedValue(0)
    validSharp()
    putMock.mockRejectedValue(new Error('s3'))
    await expect(new RoadReportService(uploadRepo).create('user-1', input, [file()])).rejects.toThrow('s3')
    expect(uploadRepo.create).not.toHaveBeenCalled()
  })

  it('refuses images whose parent report is resolved or expired', async () => {
    const repo = repository()
    const uuid = '11111111-1111-4111-8111-111111111111'
    repo.findImage.mockResolvedValueOnce({ objectKey: 'reports/image.webp', report: { resolvedAt: createdAt, expiresAt } }).mockResolvedValueOnce({ objectKey: 'reports/image.webp', report: { resolvedAt: null, expiresAt: new Date('2026-08-30T09:00:00.000Z') } })
    await expect(new RoadReportService(repo).image(uuid)).rejects.toMatchObject({ code: 'report_image_not_found' })
    await expect(new RoadReportService(repo).image(uuid)).rejects.toMatchObject({ code: 'report_image_not_found' })
    expect(getMock).not.toHaveBeenCalled()
  })

  it('validates image IDs, resolves storage keys, and propagates storage failures', async () => {
    const repo = repository()
    await expect(new RoadReportService(repo).image('bad-id')).rejects.toMatchObject({ statusCode: 404, code: 'report_image_not_found' })
    expect(repo.findImage).not.toHaveBeenCalled()

    const activeImage = { objectKey: 'reports/image.webp', report: { resolvedAt: null, expiresAt } }
    repo.findImage.mockResolvedValueOnce(null).mockResolvedValueOnce(activeImage).mockResolvedValueOnce(activeImage)
    const uuid = '11111111-1111-4111-8111-111111111111'
    await expect(new RoadReportService(repo).image(uuid)).rejects.toMatchObject({ code: 'report_image_not_found' })
    getMock.mockResolvedValueOnce({ body: Buffer.from('image'), contentType: 'image/webp', etag: 'etag' })
    await expect(new RoadReportService(repo).image(uuid)).resolves.toMatchObject({ etag: 'etag' })
    getMock.mockRejectedValueOnce(new Error('storage'))
    await expect(new RoadReportService(repo).image(uuid)).rejects.toThrow('storage')
  })

  it('serializes nearby reports with viewer state, lifecycle status, and transparent evidence', async () => {
    const repo = repository()
    repo.findNearby.mockResolvedValue([
      report({ user: null, verifications: [{ userId: 'viewer-1', verdict: 'CONFIRM' }, { userId: 'user-2', verdict: 'DISPUTE' }] }),
    ])
    const bounds = { north: -6, south: -7, east: 107, west: 106 }
    const result = await new RoadReportService(repo).nearby(bounds, 'viewer-1')
    expect(repo.findNearby).toHaveBeenCalledWith(bounds, new Date('2026-08-30T10:00:00.000Z'))
    expect(result[0]).toMatchObject({ reporter: 'Community member', status: 'ACTIVE', isOwner: false, verification: { confirmations: 1, disputes: 1, viewerVerdict: 'CONFIRM' }, evidence: { kind: 'EVIDENCE_SCORE', score: 50, level: 'MEDIUM' } })
    expect(result[0].evidence.factors).toEqual({ recency: 40, photos: 10, voteBalance: 0 })
  })

  it('lists the viewer reports including inactive lifecycle states', async () => {
    const repo = repository()
    repo.findMine.mockResolvedValue([report({ resolvedAt: createdAt })])
    const result = await new RoadReportService(repo).mine('user-1')
    expect(result).toEqual([expect.objectContaining({ status: 'RESOLVED', isOwner: true, images: [] })])
    expect(result[0].evidence.factors).toEqual({ recency: 40, photos: 10, voteBalance: 0 })
    expect(repo.findMine).toHaveBeenCalledWith('user-1')
  })

  it('upserts votes, supports vote updates, and returns updated evidence', async () => {
    const repo = repository()
    repo.findById.mockResolvedValueOnce(report()).mockResolvedValueOnce(report({ verifications: [{ userId: 'viewer-1', verdict: 'CONFIRM' }] }))
    repo.verifyActive.mockResolvedValueOnce(report({ verifications: [{ userId: 'viewer-1', verdict: 'CONFIRM' }] })).mockResolvedValueOnce(report({ verifications: [{ userId: 'viewer-1', verdict: 'DISPUTE' }] }))
    const confirmed = await new RoadReportService(repo).verify('report-1', 'viewer-1', 'CONFIRM')
    expect(confirmed.verification).toEqual({ confirmations: 1, disputes: 0, viewerVerdict: 'CONFIRM' })
    expect(confirmed.evidence.factors).toEqual({ recency: 40, photos: 10, voteBalance: 15 })
    expect(repo.verifyActive).toHaveBeenCalledWith('report-1', 'viewer-1', 'CONFIRM', expect.any(Date))

    repo.findById.mockResolvedValueOnce(report())
    const disputed = await new RoadReportService(repo).verify('report-1', 'viewer-1', 'DISPUTE')
    expect(disputed.verification).toEqual({ confirmations: 0, disputes: 1, viewerVerdict: 'DISPUTE' })
    expect(disputed.evidence.factors).toEqual({ recency: 40, photos: 10, voteBalance: 0 })
  })

  it('rejects self-verification and inactive report verification', async () => {
    const repo = repository()
    repo.findById.mockResolvedValueOnce(report()).mockResolvedValueOnce(report({ userId: 'other', resolvedAt: createdAt })).mockResolvedValueOnce(report({ userId: 'other', expiresAt: new Date('2026-08-30T09:00:00.000Z') }))
    repo.verifyActive.mockResolvedValue(null)
    const service = new RoadReportService(repo)
    await expect(service.verify('report-1', 'user-1', 'CONFIRM')).rejects.toMatchObject({ statusCode: 400, code: 'report_self_verification' })
    await expect(service.verify('report-1', 'viewer-1', 'CONFIRM')).rejects.toMatchObject({ statusCode: 409, code: 'report_inactive' })
    await expect(service.verify('report-1', 'viewer-1', 'CONFIRM')).rejects.toMatchObject({ statusCode: 409, code: 'report_inactive' })
    expect(repo.verifyActive).toHaveBeenCalledTimes(2)
  })

  it('rejects a vote when the atomic active-report mutation loses a resolve race', async () => {
    const repo = repository()
    repo.findById.mockResolvedValue(report({ userId: 'other' }))
    repo.verifyActive.mockResolvedValue(null)
    await expect(new RoadReportService(repo).verify('report-1', 'viewer-1', 'CONFIRM')).rejects.toMatchObject({ statusCode: 409, code: 'report_inactive' })
  })

  it('retracts a vote idempotently and returns current evidence', async () => {
    const repo = repository()
    repo.deleteVerification.mockResolvedValue({ count: 0 })
    repo.findById.mockResolvedValue(report())
    const result = await new RoadReportService(repo).retractVerification('report-1', 'viewer-1')
    expect(result.verification).toEqual({ confirmations: 0, disputes: 0, viewerVerdict: null })
    expect(result.evidence.factors).toEqual({ recency: 40, photos: 10, voteBalance: 0 })
    expect(repo.deleteVerification).toHaveBeenCalledWith('report-1', 'viewer-1')
  })

  it('allows only the owner to resolve an active report', async () => {
    const repo = repository()
    repo.findById.mockResolvedValueOnce(report({ userId: 'other' })).mockResolvedValueOnce(report())
    repo.resolveActive.mockResolvedValue(report({ resolvedAt: createdAt }))
    const service = new RoadReportService(repo)
    await expect(service.resolve('report-1', 'user-1')).rejects.toMatchObject({ statusCode: 404, code: 'road_report_not_found' })
    await expect(service.resolve('report-1', 'user-1')).resolves.toMatchObject({ status: 'RESOLVED', isOwner: true })
    expect(repo.resolveActive).toHaveBeenCalledWith('report-1', 'user-1', expect.any(Date))
  })

  it('returns conflict when owner resolution loses the active-status race', async () => {
    const repo = repository()
    repo.findById.mockResolvedValue(report())
    repo.resolveActive.mockResolvedValue(null)
    await expect(new RoadReportService(repo).resolve('report-1', 'user-1')).rejects.toMatchObject({ statusCode: 409, code: 'report_inactive' })
  })

  it('keeps evidence within score boundaries for disputed old and confirmed fresh reports', async () => {
    const repo = repository()
    repo.findNearby.mockResolvedValue([
      report({ createdAt: new Date('2026-08-29T10:00:00.000Z'), images: [], verifications: [{ userId: 'a', verdict: 'DISPUTE' }] }),
      report({ images: [{ id: '1' }, { id: '2' }, { id: '3' }], verifications: [{ userId: 'a', verdict: 'CONFIRM' }, { userId: 'b', verdict: 'CONFIRM' }] }),
    ])
    const result = await new RoadReportService(repo).nearby({ north: 1, south: 0, east: 1, west: 0 }, null)
    expect(result[0].evidence).toMatchObject({ score: 0, level: 'LOW' })
    expect(result[1].evidence).toMatchObject({ score: 100, level: 'HIGH' })
  })
})

describe('road report endpoint controllers', () => {
  it('POST validates multipart fields, defaults missing files, and returns 201', async () => {
    const service = { create: jest.fn().mockResolvedValue({ id: 'report-1' }) }
    const res = response({ userId: 'user-1' })
    await new RoadReportController(service as never).create(request({ body: { ...input, latitude: '-6.2', longitude: '106.8' } }), res, next())
    expect(service.create).toHaveBeenCalledWith('user-1', input, [])
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'report-1' } })
  })

  it('POST sends validation failures through the central error handler', async () => {
    const service = { create: jest.fn() }
    let caught: unknown
    try { await new RoadReportController(service as never).create(request({ body: { ...input, description: 'short' } }), response({ userId: 'user-1' }), next()) } catch (error) { caught = error }
    const res = response()
    errorHandler(caught, request({ path: '/api/v1/road-reports' }), res, next())
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'validation_error', message: 'Check the submitted details.', retryable: false, fields: { description: expect.any(String) } } })
    expect(service.create).not.toHaveBeenCalled()
  })

  it('passes representative real AppErrors through the central handler', () => {
    const failure = new AppError(429, 'report_rate_limited', 'Wait before submitting another road report.', false)
    const res = response()
    errorHandler(failure, request({ path: '/api/v1/road-reports' }), res, next())
    expect(failure).toBeInstanceOf(AppError)
    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'report_rate_limited', message: failure.message, retryable: false } })
  })

  it.each([
    [{ body: Buffer.from('image'), contentType: 'image/webp', etag: 'etag' }, { ETag: 'etag' }],
    [{ body: Buffer.from('image'), contentType: 'image/jpeg' }, {}],
  ])('GET image writes safe headers with optional ETag', async (image, optionalHeaders) => {
    const service = { image: jest.fn().mockResolvedValue(image) }
    const res = response()
    await new RoadReportController(service as never).image(request({ params: { id: 'image-1' } }), res, next())
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': image.contentType, 'Content-Length': String(image.body.length), 'Cross-Origin-Resource-Policy': 'cross-origin', ...optionalHeaders }))
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.send).toHaveBeenCalledWith(image.body)
  })

  it('adapts mine, verification, retraction, and resolution endpoints', async () => {
    const service = {
      mine: jest.fn().mockResolvedValue([{ id: 'report-1' }]),
      verify: jest.fn().mockResolvedValue({ verification: { confirmations: 1 } }),
      retractVerification: jest.fn().mockResolvedValue({ verification: { confirmations: 0 } }),
      resolve: jest.fn().mockResolvedValue({ id: 'report-1', status: 'RESOLVED' }),
    }
    const controller = new RoadReportController(service as never)
    const res = response({ userId: 'user-1' })
    const id = '11111111-1111-4111-8111-111111111111'
    await controller.mine(request(), res, next())
    await controller.verify(request({ params: { id }, body: { verdict: 'CONFIRM' } }), res, next())
    await controller.retractVerification(request({ params: { id } }), res, next())
    await controller.resolve(request({ params: { id }, body: { status: 'RESOLVED' } }), res, next())
    expect(service.mine).toHaveBeenCalledWith('user-1')
    expect(service.verify).toHaveBeenCalledWith(id, 'user-1', 'CONFIRM')
    expect(service.retractVerification).toHaveBeenCalledWith(id, 'user-1')
    expect(service.resolve).toHaveBeenCalledWith(id, 'user-1')
  })

  it('GET nearby validates/coerces bounds and wraps results', async () => {
    const reports = [{ id: 'report-1' }]
    jest.mocked(auth.api.getSession).mockResolvedValueOnce({ user: { id: 'viewer-1' } } as never)
    const service = { nearby: jest.fn().mockResolvedValue(reports) }
    const res = response()
    await new RoadReportController(service as never).nearby(request({ query: { north: '-6', south: '-7', east: '107', west: '106' } }), res, next())
    expect(service.nearby).toHaveBeenCalledWith({ north: -6, south: -7, east: 107, west: 106 }, 'viewer-1')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ data: reports })
  })

  it('GET nearby remains public when optional session lookup fails', async () => {
    const reports = [{ id: 'report-1' }]
    jest.mocked(auth.api.getSession).mockRejectedValueOnce(new Error('session database timeout'))
    const service = { nearby: jest.fn().mockResolvedValue(reports) }
    const res = response()
    await new RoadReportController(service as never).nearby(request({ query: { north: '-6', south: '-7', east: '107', west: '106' } }), res, next())
    expect(service.nearby).toHaveBeenCalledWith({ north: -6, south: -7, east: 107, west: 106 }, null)
    expect(res.status).toHaveBeenCalledWith(200)
  })
})
