jest.mock('../src/config/index.js', () => ({ auth: { api: { getSession: jest.fn() } } }))

import { RouteComparisonRepository } from '../src/modules/route-comparison/route-comparison.repository'

function prisma() {
  const transaction = jest.fn(async (operation: (client: unknown) => unknown) => operation(client))
  const client = {
    trRouteResult: { findFirst: jest.fn() },
    trRoutePlace: { findUnique: jest.fn(), updateMany: jest.fn(), upsert: jest.fn() },
  }
  return { ...client, $transaction: transaction, client }
}

describe('route place association repository', () => {
  it('returns an owned association by route, kind, ordinal, and role', async () => {
    const db = prisma()
    db.trRouteResult.findFirst.mockResolvedValue({ id: 'route-result' })
    const refreshedAt = new Date('2026-08-15T00:00:00.000Z')
    db.trRoutePlace.findUnique.mockResolvedValue({ id: 'association-1', placeId: 'stored-place', placeIdRefreshedAt: refreshedAt, role: 'departure' })
    const result = await new RouteComparisonRepository(db as never).findOwnedPlaceAssociation('user-1', 'route-result', 'TRANSIT_STOP', 0, 'departure')
    expect(result).toEqual({ id: 'association-1', placeId: 'stored-place', placeIdRefreshedAt: refreshedAt })
    expect(db.trRouteResult.findFirst).toHaveBeenCalledWith({ where: { id: 'route-result', comparison: { userId: 'user-1' } }, select: { id: true } })
    expect(db.trRoutePlace.findUnique).toHaveBeenCalledWith({ where: { routeResultId_kind_ordinal: { routeResultId: 'route-result', kind: 'TRANSIT_STOP', ordinal: 0 } }, select: { id: true, placeId: true, placeIdRefreshedAt: true, role: true } })
  })

  it('returns 404 before reading or writing associations for a nonowned route result', async () => {
    const db = prisma()
    db.trRouteResult.findFirst.mockResolvedValue(null)
    const repo = new RouteComparisonRepository(db as never)
    await expect(repo.findOwnedPlaceAssociation('other-user', 'route-result', 'TRANSIT_STOP', 0, 'departure')).rejects.toMatchObject({ statusCode: 404, code: 'route_result_not_found' })
    await expect(repo.savePlaceAssociations('other-user', 'route-result', 'REST_STOP', [{ placeId: 'place-1', ordinal: 0 }])).rejects.toMatchObject({ statusCode: 404, code: 'route_result_not_found' })
    expect(db.trRoutePlace.findUnique).not.toHaveBeenCalled()
    expect(db.trRoutePlace.upsert).not.toHaveBeenCalled()
  })

  it('atomically refreshes only an association owned by the user', async () => {
    const db = prisma()
    db.trRoutePlace.updateMany.mockResolvedValue({ count: 1 })
    await expect(new RouteComparisonRepository(db as never).refreshPlaceAssociation('user-1', 'association-1', 'replacement-place')).resolves.toBeUndefined()
    expect(db.trRoutePlace.updateMany).toHaveBeenCalledWith({
      where: { id: 'association-1', routeResult: { comparison: { userId: 'user-1' } } },
      data: { placeId: 'replacement-place', placeIdRefreshedAt: expect.any(Date) },
    })
  })

  it('preserves ownership when refreshing an association', async () => {
    const db = prisma()
    db.trRoutePlace.updateMany.mockResolvedValue({ count: 0 })
    await expect(new RouteComparisonRepository(db as never).refreshPlaceAssociation('other-user', 'association-1', 'replacement-place')).rejects.toMatchObject({ statusCode: 404, code: 'route_result_not_found' })
  })

  it('upserts allowed association fields and returns ordinal mappings', async () => {
    const db = prisma()
    db.trRouteResult.findFirst.mockResolvedValue({ id: 'route-result' })
    db.trRoutePlace.upsert
      .mockResolvedValueOnce({ id: 'association-1', ordinal: 0 })
      .mockResolvedValueOnce({ id: 'association-2', ordinal: 1 })
    const associations = [{ placeId: 'place-1', ordinal: 0 }, { placeId: 'place-2', ordinal: 1 }]
    await expect(new RouteComparisonRepository(db as never).savePlaceAssociations('user-1', 'route-result', 'REST_STOP', associations)).resolves.toEqual([{ id: 'association-1', ordinal: 0 }, { id: 'association-2', ordinal: 1 }])
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    const writes = db.trRoutePlace.upsert.mock.calls.map(([value]) => value)
    expect(writes).toEqual(associations.map((association) => ({
      where: { routeResultId_kind_ordinal: { routeResultId: 'route-result', kind: 'REST_STOP', ordinal: association.ordinal } },
      create: { routeResultId: 'route-result', kind: 'REST_STOP', ordinal: association.ordinal, placeId: association.placeId },
      update: { placeId: association.placeId, role: null, placeIdRefreshedAt: expect.any(Date) },
      select: { id: true, ordinal: true },
    })))
    expect(JSON.stringify(writes)).not.toMatch(/name|address|latitude|longitude|types|facilities|accessibility|googleMapsUri|photos|attributions/)
  })
})
