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
})
