jest.mock('../src/middleware/index.js', () => jest.requireActual('../src/middleware/errors'))

import { Prisma } from '../src/generated/prisma/client'
import { InsightsController } from '../src/modules/insights/insights.controller'
import type { InsightsRepository } from '../src/modules/insights/insights.repository'
import { InsightsService } from '../src/modules/insights/insights.service'
import { createSavedCommuteSchema, createTripImpactSchema, updateSavedCommuteSchema } from '../src/modules/insights/insights.validation'
import { next, request, response } from './helpers'

const commuteInput = {
  name: 'Morning commute',
  origin: { label: 'Home', latitude: -6.2, longitude: 106.8 },
  destination: { label: 'Office', latitude: -6.21, longitude: 106.81 },
  mode: 'BICYCLE' as const,
  preference: 'lower-exposure' as const,
  transitModes: [] as Array<'BUS' | 'TRAIN' | 'SUBWAY' | 'LIGHT_RAIL' | 'RAIL'>,
  transitPreference: null,
  accessibilityMode: 'STANDARD' as const,
  sensitiveUser: false,
  watchEnabled: true,
  watchHour: 7,
}
const tripInput = {
  routeResultId: '22222222-2222-4222-8222-222222222222',
}
const comparisonId = '11111111-1111-4111-8111-111111111111'
const createdAt = new Date('2026-09-01T01:00:00.000Z')
const updatedAt = new Date('2026-09-01T02:00:00.000Z')

function repository() {
  return {
    listSavedCommutes: jest.fn(),
    createSavedCommute: jest.fn(),
    findSavedCommute: jest.fn(),
    updateSavedCommute: jest.fn(),
    deleteSavedCommute: jest.fn(),
    findTripImpactSource: jest.fn(),
    createTripImpact: jest.fn(),
    listTripImpacts: jest.fn(),
  } as unknown as jest.Mocked<InsightsRepository>
}

function commute(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111', userId: 'user-1', name: commuteInput.name,
    originLabel: 'Home', originLatitude: -6.2, originLongitude: 106.8,
    destinationLabel: 'Office', destinationLatitude: -6.21, destinationLongitude: 106.81,
    mode: 'BICYCLE', preference: 'lower_exposure', transitModes: [], transitPreference: null, accessibilityMode: 'STANDARD', sensitiveUser: false, watchEnabled: true,
    watchHour: 7, createdAt, updatedAt, ...overrides,
  } as never
}

function trip(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333', userId: 'user-1', routeResultId: tripInput.routeResultId,
    mode: 'WALK', distanceMeters: 1200, durationSeconds: 900, activeDistanceMeters: 1200,
    activeDurationSeconds: 900, baselineExposureIndex: 20, selectedExposureIndex: 12,
    fewerConfirmedReportSignals: 2, completedAt: createdAt, routeResult: { comparisonId }, ...overrides,
  } as never
}

function tripSource(mode: 'WALK' | 'BICYCLE' | 'TRANSIT' = 'WALK') {
  return {
    comparisonId,
    mode,
    routes: [
      { id: tripInput.routeResultId, labels: ['LOWEST_EXPOSURE'], distanceMeters: 1200, durationSeconds: 900, activeDistanceMeters: mode === 'TRANSIT' ? 300 : 1200, activeDurationSeconds: mode === 'TRANSIT' ? 240 : 900, estimatedExposureIndex: 12, fewerConfirmedReportSignals: 2 },
      { id: '44444444-4444-4444-8444-444444444444', labels: ['FASTEST'], distanceMeters: 1000, durationSeconds: 600, activeDistanceMeters: mode === 'TRANSIT' ? 0 : 1000, activeDurationSeconds: mode === 'TRANSIT' ? 0 : 600, estimatedExposureIndex: 20, fewerConfirmedReportSignals: 0 },
    ],
  } as never
}

describe('insights validation', () => {
  it('normalizes saved commute input', () => {
    expect(createSavedCommuteSchema.parse({ ...commuteInput, name: '  Morning commute  ', watchHour: '7' })).toEqual(commuteInput)
  })

  it.each([
    [{ ...commuteInput, name: '' }],
    [{ ...commuteInput, name: 'x'.repeat(81) }],
    [{ ...commuteInput, origin: { ...commuteInput.origin, label: 'x'.repeat(181) } }],
    [{ ...commuteInput, origin: { ...commuteInput.origin, latitude: 91 } }],
    [{ ...commuteInput, destination: { ...commuteInput.destination, longitude: 181 } }],
    [{ ...commuteInput, mode: 'CAR' }],
    [{ ...commuteInput, preference: 'fastest' }],
    [{ ...commuteInput, watchHour: 24 }],
    [{ ...commuteInput, watchHour: 1.5 }],
  ])('rejects invalid saved commute input', (value) => expect(() => createSavedCommuteSchema.parse(value)).toThrow())

  it('requires at least one field and enforces transit option compatibility for saved commute updates', () => {
    expect(updateSavedCommuteSchema.parse({ watchEnabled: false })).toEqual({ watchEnabled: false })
    expect(updateSavedCommuteSchema.parse({ watchHour: null })).toEqual({ watchHour: null })
    expect(updateSavedCommuteSchema.parse({ mode: 'TRANSIT', transitModes: ['BUS', 'SUBWAY'], transitPreference: 'LESS_WALKING', accessibilityMode: 'REDUCED_EXERTION' })).toMatchObject({ transitModes: ['BUS', 'SUBWAY'], transitPreference: 'LESS_WALKING' })
    expect(() => updateSavedCommuteSchema.parse({ mode: 'WALK', transitModes: ['BUS'] })).toThrow()
    expect(() => updateSavedCommuteSchema.parse({ mode: 'BICYCLE', transitPreference: 'FEWER_TRANSFERS' })).toThrow()
    expect(() => updateSavedCommuteSchema.parse({})).toThrow()
  })

  it('accepts only persisted comparison and route result identifiers', () => {
    expect(createTripImpactSchema.parse(tripInput)).toEqual(tripInput)
  })

  it.each([
    [{ ...tripInput, comparisonId: 'bad' }],
    [{ ...tripInput, routeResultId: 'bad' }],
    [{ ...tripInput, distanceMeters: 1 }],
    [{ ...tripInput, selectedExposureIndex: 1 }],
    [{ ...tripInput, mode: 'WALK' }],
    [{ ...tripInput, fewerConfirmedReportSignals: -1 }],
  ])('rejects invalid or client-controlled trip metrics', (value) => expect(() => createTripImpactSchema.parse(value)).toThrow())
})

describe('insights service', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T12:00:00.000Z'))
  })
  afterEach(() => jest.useRealTimers())

  it('lists and serializes owner saved commutes', async () => {
    const repo = repository()
    repo.listSavedCommutes.mockResolvedValue([commute()])
    await expect(new InsightsService(repo).savedCommutes('user-1')).resolves.toEqual([expect.objectContaining({
      id: '11111111-1111-4111-8111-111111111111', preference: 'lower-exposure', origin: commuteInput.origin,
      destination: commuteInput.destination, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString(),
    })])
    expect(repo.listSavedCommutes).toHaveBeenCalledWith('user-1')
  })

  it('creates a saved commute with persistence enum mapping', async () => {
    const repo = repository()
    repo.createSavedCommute.mockResolvedValue(commute())
    await new InsightsService(repo).createSavedCommute('user-1', commuteInput)
    expect(repo.createSavedCommute).toHaveBeenCalledWith('user-1', expect.objectContaining({ preference: 'lower_exposure', originLabel: 'Home', destinationLongitude: 106.81 }))
  })

  it('updates only owner saved commutes and returns owner-scoped 404', async () => {
    const repo = repository()
    repo.findSavedCommute.mockResolvedValueOnce(commute()).mockResolvedValueOnce(null)
    repo.updateSavedCommute.mockResolvedValue(commute({ watchEnabled: false, watchHour: null }))
    await expect(new InsightsService(repo).updateSavedCommute('user-1', commuteInput.origin.label === 'Home' ? '11111111-1111-4111-8111-111111111111' : '', { watchEnabled: false, watchHour: null })).resolves.toMatchObject({ watchEnabled: false, watchHour: null })
    expect(repo.updateSavedCommute).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', expect.objectContaining({ watchEnabled: false, watchHour: null }))
    await expect(new InsightsService(repo).updateSavedCommute('user-2', '11111111-1111-4111-8111-111111111111', { name: 'Other' })).rejects.toMatchObject({ statusCode: 404, code: 'saved_commute_not_found' })
  })

  it('clears transit fields when changing mode and rejects transit options on non-transit records', async () => {
    const repo = repository()
    repo.findSavedCommute.mockResolvedValueOnce(commute({ mode: 'TRANSIT', transitModes: ['BUS'], transitPreference: 'LESS_WALKING' })).mockResolvedValueOnce(commute({ mode: 'WALK' }))
    repo.updateSavedCommute.mockResolvedValue(commute({ mode: 'WALK', transitModes: [], transitPreference: null }))
    await new InsightsService(repo).updateSavedCommute('user-1', commute().id, { mode: 'WALK' })
    expect(repo.updateSavedCommute).toHaveBeenCalledWith(commute().id, expect.objectContaining({ mode: 'WALK', transitModes: [], transitPreference: null }))
    await expect(new InsightsService(repo).updateSavedCommute('user-1', commute().id, { transitModes: ['BUS'] })).rejects.toMatchObject({ code: 'saved_commute_transit_options_invalid' })
  })

  it('deletes owner saved commutes and rejects missing ownership', async () => {
    const repo = repository()
    repo.findSavedCommute.mockResolvedValueOnce(commute()).mockResolvedValueOnce(null)
    await expect(new InsightsService(repo).deleteSavedCommute('user-1', '11111111-1111-4111-8111-111111111111')).resolves.toEqual({ deleted: true })
    expect(repo.deleteSavedCommute).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
    await expect(new InsightsService(repo).deleteSavedCommute('user-2', '11111111-1111-4111-8111-111111111111')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('derives trip metrics from the owned persisted comparison and rejects nonmatching sources', async () => {
    const repo = repository()
    repo.findTripImpactSource.mockResolvedValueOnce(tripSource()).mockResolvedValueOnce(null)
    repo.createTripImpact.mockResolvedValue(trip())
    await expect(new InsightsService(repo).recordTripImpact('user-1', tripInput)).resolves.toMatchObject({ id: '33333333-3333-4333-8333-333333333333', completedAt: createdAt.toISOString() })
    expect(repo.findTripImpactSource).toHaveBeenCalledWith('user-1', tripInput.routeResultId)
    expect(repo.createTripImpact).toHaveBeenCalledWith('user-1', new Date('2026-09-01T00:00:00.000Z'), 50, expect.objectContaining({ routeResultId: tripInput.routeResultId, mode: 'WALK', distanceMeters: 1200, durationSeconds: 900, activeDistanceMeters: 1200, activeDurationSeconds: 900, baselineExposureIndex: 20, selectedExposureIndex: 12, fewerConfirmedReportSignals: 2 }))
    expect(repo.createTripImpact.mock.calls[0][3]).not.toHaveProperty('comparisonId')
    await expect(new InsightsService(repo).recordTripImpact('user-2', tripInput)).rejects.toMatchObject({ statusCode: 404, code: 'trip_impact_source_not_found' })
    expect(repo.createTripImpact).toHaveBeenCalledTimes(1)
  })

  it('maps duplicate completed route results to conflict', async () => {
    const repo = repository()
    repo.findTripImpactSource.mockResolvedValue(tripSource())
    repo.createTripImpact.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7.9.1' }))
    await expect(new InsightsService(repo).recordTripImpact('user-1', tripInput)).rejects.toMatchObject({ statusCode: 409, code: 'trip_impact_already_recorded' })
  })

  it('records only transit walking distance and duration as active travel', async () => {
    const repo = repository()
    repo.findTripImpactSource.mockResolvedValue(tripSource('TRANSIT'))
    repo.createTripImpact.mockResolvedValue(trip({ mode: 'TRANSIT', activeDistanceMeters: 300, activeDurationSeconds: 240 }))
    await new InsightsService(repo).recordTripImpact('user-1', tripInput)
    expect(repo.createTripImpact).toHaveBeenCalledWith('user-1', new Date('2026-09-01T00:00:00.000Z'), 50, expect.objectContaining({ mode: 'TRANSIT', distanceMeters: 1200, durationSeconds: 900, activeDistanceMeters: 300, activeDurationSeconds: 240 }))
  })

  it('records the fiftieth daily trip and rejects the fifty-first atomically', async () => {
    const repo = repository()
    repo.findTripImpactSource.mockResolvedValue(tripSource())
    repo.createTripImpact.mockResolvedValueOnce(trip()).mockResolvedValueOnce(null)
    await new InsightsService(repo).recordTripImpact('user-1', tripInput)
    expect(repo.createTripImpact).toHaveBeenCalledWith('user-1', new Date('2026-09-01T00:00:00.000Z'), 50, expect.any(Object))
    await expect(new InsightsService(repo).recordTripImpact('user-1', tripInput)).rejects.toMatchObject({ statusCode: 429, code: 'trip_impact_rate_limited' })
    expect(repo.createTripImpact).toHaveBeenCalledTimes(2)
  })

  it('summarizes active travel and clamps modeled reduction at zero', async () => {
    const repo = repository()
    repo.listTripImpacts.mockResolvedValue([
      trip(),
      trip({ id: 'trip-2', mode: 'TRANSIT', distanceMeters: 800, durationSeconds: 300, activeDistanceMeters: 0, activeDurationSeconds: 0, baselineExposureIndex: 5, selectedExposureIndex: 7, fewerConfirmedReportSignals: 1 }),
    ])
    await expect(new InsightsService(repo).tripImpactSummary('user-1')).resolves.toEqual({
      completedTrips: 2,
      activeTravelDistanceMeters: 1200,
      activeTravelDurationSeconds: 900,
      modeledExposureIndexBaseline: 25,
      modeledExposureIndexSelected: 19,
      modeledExposureIndexReduction: 6,
      fewerConfirmedReportSignals: 3,
      disclaimer: 'Modeled exposure indices are comparative estimates, not medical measurements or actual inhaled dose.',
    })
  })
})

describe('insights controllers', () => {
  it('adapts saved commute CRUD requests and responses', async () => {
    const service = {
      savedCommutes: jest.fn().mockResolvedValue([{ id: 'commute-1' }]),
      createSavedCommute: jest.fn().mockResolvedValue({ id: 'commute-1' }),
      updateSavedCommute: jest.fn().mockResolvedValue({ id: 'commute-1', watchEnabled: false }),
      deleteSavedCommute: jest.fn().mockResolvedValue({ deleted: true }),
    }
    const controller = new InsightsController(service as never)
    const res = response({ userId: 'user-1' })
    await controller.savedCommutes(request(), res, next())
    await controller.createSavedCommute(request({ body: commuteInput }), res, next())
    await controller.updateSavedCommute(request({ params: { id: '11111111-1111-4111-8111-111111111111' }, body: { watchEnabled: false } }), res, next())
    await controller.deleteSavedCommute(request({ params: { id: '11111111-1111-4111-8111-111111111111' } }), res, next())
    expect(service.savedCommutes).toHaveBeenCalledWith('user-1')
    expect(service.createSavedCommute).toHaveBeenCalledWith('user-1', commuteInput)
    expect(service.updateSavedCommute).toHaveBeenCalledWith('user-1', '11111111-1111-4111-8111-111111111111', { watchEnabled: false })
    expect(service.deleteSavedCommute).toHaveBeenCalledWith('user-1', '11111111-1111-4111-8111-111111111111')
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('adapts trip record and summary requests', async () => {
    const service = {
      recordTripImpact: jest.fn().mockResolvedValue({ id: 'trip-1' }),
      tripImpactSummary: jest.fn().mockResolvedValue({ completedTrips: 1 }),
    }
    const controller = new InsightsController(service as never)
    const res = response({ userId: 'user-1' })
    await controller.recordTripImpact(request({ body: tripInput }), res, next())
    await controller.tripImpactSummary(request(), res, next())
    expect(service.recordTripImpact).toHaveBeenCalledWith('user-1', tripInput)
    expect(service.tripImpactSummary).toHaveBeenCalledWith('user-1')
    expect(res.json).toHaveBeenCalledWith({ data: { completedTrips: 1 } })
  })
})
