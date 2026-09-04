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
    airQualitySampleCount: 5,
    airQualityExpectedSampleCount: 5,
    airQualitySamples: [{ latitude: -6.2, longitude: 106.8, pm25 }],
    providerLabels: [],
    hazardSummary: { level: 'NONE_REPORTED', reports: [], nearbyCount: 0, confirmedCount: 0, confirmedReportSignalScore: 0, fewerConfirmedReportSignals: 0, limitations: [] },
    heatUv: {},
    weatherConditions: [{ status: 'unavailable' }],
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

  it('keeps routing usable without fabricating air-quality values', () => {
    const unavailable = { ...route('unavailable', 10, 20), averagePm25: null, airQualityTimestamp: null, dataQuality: 'unavailable' as const, airQualitySampleCount: 0, airQualitySamples: [] }
    const result = rankRoutes([unavailable], { preference: 'lower-exposure', sensitiveUser: false, hazardPolicy: 'ADVISORY_ONLY', accessibilityMode: 'STANDARD' })

    expect(result[0]).toMatchObject({ labels: ['FASTEST', 'RECOMMENDED'], averagePm25: null, estimatedExposureIndex: null, reductionFromFastestPercent: null, confidence: { factors: { airQualityCoverage: 0 }, limitations: expect.arrayContaining(['Kualitas udara tidak tersedia untuk rute ini.']) } })
    expect(result[0].labels).not.toContain('LOWEST_EXPOSURE')
    expect(JSON.stringify(result[0].explanation)).not.toMatch(/modeled exposure|PM2\.5-time/i)
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
    expect(result.find((item) => item.labels.includes('LOWEST_EXPOSURE'))?.id).toBe('first')
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

  it('uses report signals only under the prefer-fewer policy', () => {
    const fewer = route('fewer', 10, 20)
    const cleaner = route('cleaner', 10, 10)
    cleaner.hazardSummary.confirmedReportSignalScore = 6
    expect(rankRoutes([fewer, cleaner], { preference: 'balanced', sensitiveUser: false, hazardPolicy: 'PREFER_FEWER_REPORTS', accessibilityMode: 'STANDARD' }).find((item) => item.labels.includes('RECOMMENDED'))?.id).toBe('fewer')
    expect(rankRoutes([fewer, cleaner], { preference: 'balanced', sensitiveUser: false, hazardPolicy: 'ADVISORY_ONLY', accessibilityMode: 'STANDARD' }).find((item) => item.labels.includes('RECOMMENDED'))?.id).toBe('cleaner')
  })

  it('allows a weak route to win when all routes are weak and reports low completeness', () => {
    const dirty = route('dirty', 10, 20)
    const clean = route('clean', 11, 5)
    for (const item of [dirty, clean]) {
      item.airQualitySampleCount = 2
      item.weatherConditions = [{ status: 'unavailable' }]
    }
    const result = rankRoutes([dirty, clean], { preference: 'lower-exposure', sensitiveUser: false, hazardPolicy: 'ADVISORY_ONLY', accessibilityMode: 'REDUCED_EXERTION' })
    expect(result.find((item) => item.labels.includes('RECOMMENDED'))?.id).toBe('clean')
    expect(result[0].confidence).toMatchObject({ level: 'LOW', limitations: expect.arrayContaining(['Kualitas udara dihitung dari sebagian sampel rute.', 'Cuaca tidak tersedia pada satu atau beberapa titik sampel.']) })
    expect(result[0].accessibility).toMatchObject({ assessment: 'APPROXIMATION' })
  })

  it('falls back to the fastest route when no strong-air-quality route is within the balanced duration cap', () => {
    const fastest = route('fast-weak', 10, 20)
    fastest.airQualitySampleCount = 2
    const result = rankRoutes([fastest, route('slow-strong', 15, 1)], { preference: 'balanced', sensitiveUser: false, hazardPolicy: 'ADVISORY_ONLY', accessibilityMode: 'STANDARD' })
    const recommended = result.find((item) => item.labels.includes('RECOMMENDED'))
    expect(recommended).toMatchObject({ id: 'fast-weak', explanation: { reasons: expect.arrayContaining([expect.stringMatching(/batas durasi/i)]), tradeoffs: expect.arrayContaining([expect.stringMatching(/bukti kualitas udara yang lebih lemah/i)]) } })
  })
})
