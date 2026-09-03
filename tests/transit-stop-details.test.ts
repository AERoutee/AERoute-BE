jest.mock('../src/config/index.js', () => ({ auth: { api: { getSession: jest.fn() } } }))
import { TransitStopDetailsController } from '../src/modules/route-comparison/transit-stop-details.controller'
import { next, request, response } from './helpers'

const detailsMock = jest.fn()
const input = { name: '  Central Station  ', latitude: -6.2, longitude: 106.8 }

describe('transit stop details controller', () => {
  beforeEach(() => { jest.clearAllMocks(); detailsMock.mockResolvedValue({ status: 'NOT_FOUND' }) })

  const createController = () => new TransitStopDetailsController({ details: detailsMock } as never)

  it('strictly validates and trims the request before calling Places', async () => {
    const res = response({ userId: 'user-1' })
    await createController().details(request({ body: input }), res, next())
    expect(detailsMock).toHaveBeenCalledWith({ name: 'Central Station', latitude: -6.2, longitude: 106.8 }, 'user-1')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ data: { status: 'NOT_FOUND' } })
  })

  it('passes complete association context and sets no-store', async () => {
    const res = response({ userId: 'user-1' })
    const association = { routeResultId: '11111111-1111-4111-8111-111111111111', ordinal: 0, role: 'departure' }
    await createController().details(request({ body: { ...input, ...association } }), res, next())
    expect(detailsMock).toHaveBeenCalledWith({ name: 'Central Station', latitude: -6.2, longitude: 106.8, ...association }, 'user-1')
    expect(res.set).toHaveBeenCalledWith({ 'Cache-Control': 'private, no-store' })
  })

  it.each([
    {},
    { ...input, name: '' },
    { ...input, name: 'x'.repeat(161) },
    { ...input, name: 'Central\u0000Station' },
    { ...input, latitude: Number.NaN },
    { ...input, latitude: Number.POSITIVE_INFINITY },
    { ...input, latitude: -90.01 },
    { ...input, longitude: 180.01 },
    { ...input, radius: 250 },
    { ...input, type: 'bus_station' },
    { ...input, url: 'https://example.com' },
    { ...input, options: {} },
    { ...input, routeResultId: '11111111-1111-4111-8111-111111111111' },
    { ...input, routeResultId: '11111111-1111-4111-8111-111111111111', ordinal: 0 },
    { ...input, routeResultId: 'bad', ordinal: 0, role: 'departure' },
    { ...input, routeResultId: '11111111-1111-4111-8111-111111111111', ordinal: -1, role: 'departure' },
    { ...input, routeResultId: '11111111-1111-4111-8111-111111111111', ordinal: 100, role: 'arrival' },
    { ...input, routeResultId: '11111111-1111-4111-8111-111111111111', ordinal: 0, role: 'transfer' },
  ])('rejects invalid or client-controlled body %#', async (body) => {
    await expect(createController().details(request({ body }), response({ userId: 'user-1' }), next())).rejects.toThrow()
    expect(detailsMock).not.toHaveBeenCalled()
  })

  it('limits each user to thirty requests per five minutes independently', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-02T12:00:00.000Z'))
    const controller = createController()
    for (let count = 0; count < 30; count += 1) await controller.details(request({ body: input }), response({ userId: 'user-1' }), next())
    await expect(controller.details(request({ body: input }), response({ userId: 'user-1' }), next())).rejects.toMatchObject({ statusCode: 429, code: 'transit_stop_details_rate_limited', retryable: false })
    await expect(controller.details(request({ body: input }), response({ userId: 'user-2' }), next())).resolves.toBeUndefined()
    jest.advanceTimersByTime(300_000)
    await expect(controller.details(request({ body: input }), response({ userId: 'user-1' }), next())).resolves.toBeUndefined()
    expect(detailsMock).toHaveBeenCalledTimes(32)
    jest.useRealTimers()
  })
})
