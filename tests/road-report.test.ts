jest.mock('sharp', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('../src/middleware/index.js', () => jest.requireActual('../src/middleware/errors'))
jest.mock('../src/modules/road-report/providers/index.js', () => ({
  putRoadReportImage: jest.fn(),
  getRoadReportImage: jest.fn(),
  deleteRoadReportImage: jest.fn(),
}))

import sharp from 'sharp'
import { AppError, errorHandler } from '../src/middleware/errors'
import { RoadReportController } from '../src/modules/road-report/road-report.controller'
import type { RoadReportRepository } from '../src/modules/road-report/road-report.repository'
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
  } as unknown as jest.Mocked<RoadReportRepository>
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-1', category: 'HAZARD', description: 'A meaningful hazard', latitude: -6.2, longitude: 106.8,
    createdAt, expiresAt, images: [{ id: 'image-1' }], user: { name: 'Alice Example' }, ...overrides,
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

  it('accepts valid nearby bounds and rejects order and size boundaries', () => {
    expect(nearbyRoadReportsSchema.parse({ north: '-6', south: '-7', east: '107', west: '106' })).toEqual({ north: -6, south: -7, east: 107, west: 106 })
    expect(() => nearbyRoadReportsSchema.parse({ north: 0, south: 0, east: 1, west: 0 })).toThrow('North must be greater than south.')
    expect(() => nearbyRoadReportsSchema.parse({ north: 1, south: 0, east: 0, west: 0 })).toThrow('East must be greater than west.')
    expect(() => nearbyRoadReportsSchema.parse({ north: 3, south: 0, east: 3, west: 0 })).toThrow('Map area is too large.')
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
    await expect(new RoadReportService(repo).create('user-1', input, [])).resolves.toEqual({
      id: 'report-1', category: 'HAZARD', description: input.description, latitude: -6.2, longitude: 106.8,
      createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), images: ['/api/v1/road-report-images/image-1'], reporter: 'Alice',
    })
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

  it('validates image IDs, resolves storage keys, and propagates storage failures', async () => {
    const repo = repository()
    await expect(new RoadReportService(repo).image('bad-id')).rejects.toMatchObject({ statusCode: 404, code: 'report_image_not_found' })
    expect(repo.findImage).not.toHaveBeenCalled()

    repo.findImage.mockResolvedValueOnce(null).mockResolvedValueOnce({ objectKey: 'reports/image.webp' }).mockResolvedValueOnce({ objectKey: 'reports/image.webp' })
    const uuid = '11111111-1111-4111-8111-111111111111'
    await expect(new RoadReportService(repo).image(uuid)).rejects.toMatchObject({ code: 'report_image_not_found' })
    getMock.mockResolvedValueOnce({ body: Buffer.from('image'), contentType: 'image/webp', etag: 'etag' })
    await expect(new RoadReportService(repo).image(uuid)).resolves.toMatchObject({ etag: 'etag' })
    getMock.mockRejectedValueOnce(new Error('storage'))
    await expect(new RoadReportService(repo).image(uuid)).rejects.toThrow('storage')
  })

  it('serializes nearby reports with image endpoints and anonymous fallback', async () => {
    const repo = repository()
    repo.findNearby.mockResolvedValue([report({ user: null }), report({ id: 'report-2', images: [], user: { name: 'Bob Builder' } })])
    const bounds = { north: -6, south: -7, east: 107, west: 106 }
    const result = await new RoadReportService(repo).nearby(bounds)
    expect(repo.findNearby).toHaveBeenCalledWith(bounds)
    expect(result[0]).toMatchObject({ reporter: 'Community member', images: ['/api/v1/road-report-images/image-1'] })
    expect(result[1]).toMatchObject({ id: 'report-2', reporter: 'Bob', images: [] })
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

  it('GET nearby validates/coerces bounds and wraps results', async () => {
    const reports = [{ id: 'report-1' }]
    const service = { nearby: jest.fn().mockResolvedValue(reports) }
    const res = response()
    await new RoadReportController(service as never).nearby(request({ query: { north: '-6', south: '-7', east: '107', west: '106' } }), res, next())
    expect(service.nearby).toHaveBeenCalledWith({ north: -6, south: -7, east: 107, west: 106 })
    expect(res.json).toHaveBeenCalledWith({ data: reports })
  })
})
