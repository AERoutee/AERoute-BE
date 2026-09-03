import type { RouteComparisonRepository } from '../src/modules/route-comparison/route-comparison.repository'
import { TransitStopDetailsService } from '../src/modules/route-comparison/transit-stop-details.service'
import * as places from '../src/modules/route-comparison/providers/google-places.provider'

jest.mock('../src/config/index.js', () => ({ env: { GOOGLE_MAPS_SERVER_KEY: 'places-key', PROVIDER_TIMEOUT_MS: 4321 } }))
jest.mock('../src/modules/route-comparison/providers/google-places.provider.js', () => ({ getPlaceDetails: jest.fn(), getTransitStopDetails: jest.fn() }))

const searchMock = jest.mocked(places.getTransitStopDetails)
const detailsMock = jest.mocked(places.getPlaceDetails)
const context = { routeResultId: '11111111-1111-4111-8111-111111111111', ordinal: 0, role: 'departure' as const }
const input = { name: 'Central', latitude: 1, longitude: 2, ...context }
const place = { id: 'google-place', name: 'Central', location: { latitude: 1, longitude: 2 }, types: ['train_station'], safetyVerified: false as const }

function repository() {
  return {
    findOwnedPlaceAssociation: jest.fn().mockResolvedValue(null),
    refreshPlaceAssociation: jest.fn().mockResolvedValue({ id: 'association-1' }),
    savePlaceAssociations: jest.fn().mockResolvedValue([{ id: 'association-1', ordinal: 0 }]),
  } as unknown as jest.Mocked<RouteComparisonRepository>
}

describe('transit stop details service', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    searchMock.mockResolvedValue({ status: 'AVAILABLE', place })
    detailsMock.mockResolvedValue({ status: 'AVAILABLE', place })
  })

  it('uses fresh Place Details and skips Text Search and writes for a recently refreshed association', async () => {
    const repo = repository()
    repo.findOwnedPlaceAssociation.mockResolvedValue({ id: 'association-1', placeId: 'stored-place', placeIdRefreshedAt: new Date('2026-08-15T00:00:00.000Z') })
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T00:00:00.000Z'))
    detailsMock.mockResolvedValue({ status: 'AVAILABLE', place: { ...place, id: 'stored-place' } })
    await expect(new TransitStopDetailsService(repo).details(input, 'user-1')).resolves.toEqual({ status: 'AVAILABLE', place: { ...place, id: 'stored-place', associationId: 'association-1' } })
    expect(detailsMock).toHaveBeenCalledWith('stored-place')
    expect(searchMock).not.toHaveBeenCalled()
    expect(repo.refreshPlaceAssociation).not.toHaveBeenCalled()
    expect(repo.savePlaceAssociations).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it('touches an association older than thirty days after a successful stored ID lookup', async () => {
    const repo = repository()
    repo.findOwnedPlaceAssociation.mockResolvedValue({ id: 'association-1', placeId: 'stored-place', placeIdRefreshedAt: new Date('2026-07-01T00:00:00.000Z') })
    detailsMock.mockResolvedValue({ status: 'AVAILABLE', place: { ...place, id: 'stored-place' } })
    jest.useFakeTimers().setSystemTime(new Date('2026-09-03T00:00:00.000Z'))
    await expect(new TransitStopDetailsService(repo).details(input, 'user-1')).resolves.toEqual({ status: 'AVAILABLE', place: { ...place, id: 'stored-place', associationId: 'association-1' } })
    expect(repo.refreshPlaceAssociation).toHaveBeenCalledWith('user-1', 'association-1', 'stored-place')
    expect(searchMock).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  it('replaces a missing stored ID from one fresh Text Search', async () => {
    const repo = repository()
    repo.findOwnedPlaceAssociation.mockResolvedValue({ id: 'association-1', placeId: 'stored-place', placeIdRefreshedAt: new Date() })
    detailsMock.mockResolvedValue({ status: 'NOT_FOUND' })
    await expect(new TransitStopDetailsService(repo).details(input, 'user-1')).resolves.toEqual({ status: 'AVAILABLE', place: { ...place, associationId: 'association-1' } })
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(searchMock).toHaveBeenCalledWith({ name: 'Central', latitude: 1, longitude: 2 })
    expect(repo.refreshPlaceAssociation).toHaveBeenCalledWith('user-1', 'association-1', 'google-place')
  })

  it('returns NOT_FOUND without a write when stored Details and fresh Text Search miss', async () => {
    const repo = repository()
    repo.findOwnedPlaceAssociation.mockResolvedValue({ id: 'association-1', placeId: 'stored-place', placeIdRefreshedAt: new Date() })
    detailsMock.mockResolvedValue({ status: 'NOT_FOUND' })
    searchMock.mockResolvedValue({ status: 'NOT_FOUND' })
    await expect(new TransitStopDetailsService(repo).details(input, 'user-1')).resolves.toEqual({ status: 'NOT_FOUND' })
    expect(searchMock).toHaveBeenCalledTimes(1)
    expect(repo.refreshPlaceAssociation).not.toHaveBeenCalled()
  })

  it.each(['transient', 'permanent configuration'])('does not fall back on %s Place Details errors', async (message) => {
    const repo = repository()
    repo.findOwnedPlaceAssociation.mockResolvedValue({ id: 'association-1', placeId: 'stored-place', placeIdRefreshedAt: new Date() })
    detailsMock.mockRejectedValue(new Error(message))
    await expect(new TransitStopDetailsService(repo).details(input, 'user-1')).rejects.toThrow(message)
    expect(searchMock).not.toHaveBeenCalled()
    expect(repo.refreshPlaceAssociation).not.toHaveBeenCalled()
  })

  it('does not call Places or mutate an association for a nonowner', async () => {
    const repo = repository()
    repo.findOwnedPlaceAssociation.mockRejectedValue(new Error('not owned'))
    await expect(new TransitStopDetailsService(repo).details(input, 'other-user')).rejects.toThrow('not owned')
    expect(detailsMock).not.toHaveBeenCalled()
    expect(searchMock).not.toHaveBeenCalled()
    expect(repo.refreshPlaceAssociation).not.toHaveBeenCalled()
  })

  it('updates a stored association when Details returns a replacement ID', async () => {
    const repo = repository()
    repo.findOwnedPlaceAssociation.mockResolvedValue({ id: 'association-1', placeId: 'stored-place', placeIdRefreshedAt: new Date() })
    detailsMock.mockResolvedValue({ status: 'AVAILABLE', place: { ...place, id: 'replacement-place' } })
    await expect(new TransitStopDetailsService(repo).details(input, 'user-1')).resolves.toEqual({ status: 'AVAILABLE', place: { ...place, id: 'replacement-place', associationId: 'association-1' } })
    expect(searchMock).not.toHaveBeenCalled()
    expect(repo.refreshPlaceAssociation).toHaveBeenCalledWith('user-1', 'association-1', 'replacement-place')
  })

  it('stores only the first fresh Text Search Place ID when no association exists', async () => {
    const repo = repository()
    await expect(new TransitStopDetailsService(repo).details(input, 'user-1')).resolves.toEqual({ status: 'AVAILABLE', place: { ...place, associationId: 'association-1' } })
    expect(searchMock).toHaveBeenCalledWith({ name: 'Central', latitude: 1, longitude: 2 })
    expect(repo.savePlaceAssociations).toHaveBeenCalledWith('user-1', context.routeResultId, 'TRANSIT_STOP', [{ placeId: 'google-place', ordinal: 0, role: 'departure' }])
    expect(JSON.stringify(repo.savePlaceAssociations.mock.calls[0])).not.toMatch(/Central|latitude|longitude|train_station/)
  })

  it('runs fresh Text Search without persistence when association context is absent', async () => {
    const repo = repository()
    await expect(new TransitStopDetailsService(repo).details({ name: 'Central', latitude: 1, longitude: 2 }, 'user-1')).resolves.toEqual({ status: 'AVAILABLE', place })
    expect(repo.findOwnedPlaceAssociation).not.toHaveBeenCalled()
    expect(repo.savePlaceAssociations).not.toHaveBeenCalled()
  })

  it('does not persist a missing Text Search result', async () => {
    const repo = repository()
    searchMock.mockResolvedValue({ status: 'NOT_FOUND' })
    await expect(new TransitStopDetailsService(repo).details(input, 'user-1')).resolves.toEqual({ status: 'NOT_FOUND' })
    expect(repo.savePlaceAssociations).not.toHaveBeenCalled()
  })
})
