import { rankRoutes, type RouteCandidate } from '../src/modules/route-comparison/exposure.service'

function route(id: string, minutes: number, pm25: number): RouteCandidate {
  return {
    id,
    durationSeconds: minutes * 60,
    distanceMeters: 1000,
    encodedPolyline: 'encoded',
    averagePm25: pm25,
    airQualityTimestamp: new Date(0).toISOString(),
    dataQuality: 'modeled_estimate',
    airQualitySamples: [{ latitude: -6.2, longitude: 106.8, pm25 }],
  }
}

describe('rankRoutes', () => {
  it('recommends the cleanest eligible balanced route', () => {
    const result = rankRoutes([route('fast', 10, 20), route('cleaner', 12, 10), route('slow', 15, 2)], { preference: 'balanced', sensitiveUser: false })
    expect(result.find((item) => item.labels.includes('RECOMMENDED'))?.id).toBe('cleaner')
  })

  it('allows a 35 percent window in sensitive balanced mode', () => {
    const result = rankRoutes([route('fast', 10, 20), route('cleaner', 13, 10)], { preference: 'balanced', sensitiveUser: true })
    expect(result.find((item) => item.labels.includes('RECOMMENDED'))?.id).toBe('cleaner')
  })

  it('selects the absolute lowest exposure route when requested', () => {
    const result = rankRoutes([route('fast', 10, 20), route('cleanest', 20, 2)], { preference: 'lower-exposure', sensitiveUser: false })
    expect(result.find((item) => item.labels.includes('RECOMMENDED'))?.id).toBe('cleanest')
  })

  it('returns an empty list for no candidates', () => {
    expect(rankRoutes([], { preference: 'balanced', sensitiveUser: false })).toEqual([])
  })

  it('includes a route exactly on the balanced duration boundary', () => {
    const result = rankRoutes([route('fast', 10, 20), route('boundary', 12, 5), route('outside', 12.1, 1)], { preference: 'balanced', sensitiveUser: false })
    expect(result.find((item) => item.labels.includes('RECOMMENDED'))?.id).toBe('boundary')
  })

  it('keeps first routes on duration and exposure ties and sorts by duration', () => {
    const result = rankRoutes([route('later', 12, 10), route('first', 10, 12), route('tie', 10, 12)], { preference: 'lower-exposure', sensitiveUser: false })
    expect(result.map((item) => item.id)).toEqual(['first', 'tie', 'later'])
    expect(result.find((item) => item.labels.includes('FASTEST'))?.id).toBe('first')
    expect(result.find((item) => item.labels.includes('LOWEST_EXPOSURE'))?.id).toBe('later')
  })

  it('keeps overlapping labels on a route that is fastest, recommended, and lowest exposure', () => {
    const result = rankRoutes([route('short-clean', 185, 13.3), route('long-dirty', 227, 50.1)], { preference: 'balanced', sensitiveUser: false })
    expect(result.map(({ id, labels }) => ({ id, labels }))).toEqual([
      { id: 'short-clean', labels: ['FASTEST', 'RECOMMENDED', 'LOWEST_EXPOSURE'] },
      { id: 'long-dirty', labels: [] },
    ])
  })

  it('returns zero reduction when the fastest exposure is zero', () => {
    const result = rankRoutes([route('zero', 10, 0), route('other', 11, 10)], { preference: 'balanced', sensitiveUser: false })
    expect(result.every((item) => item.reductionFromFastestPercent === 0)).toBe(true)
  })
})
