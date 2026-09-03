import { evaluateWeatherAdvisory, summarizeHeatUv, type WeatherConditions } from '../src/modules/route-comparison/weather-advisory.service'

const baseWeather: Extract<WeatherConditions, { status: 'available' }> = {
  status: 'available',
  observedAt: new Date(0).toISOString(),
  forecastOffsetMinutes: 30,
  conditionType: 'CLEAR',
  condition: 'Clear',
  isDaytime: true,
  temperatureC: 28,
  feelsLikeC: 30,
  heatIndexC: 30,
  humidityPercent: 70,
  uvIndex: 4,
  precipitationProbabilityPercent: 10,
  thunderstormProbabilityPercent: 5,
  windSpeedKph: 10,
  windGustKph: 15,
  visibilityKm: 10,
}

describe('evaluateWeatherAdvisory', () => {
  it('returns unavailable when weather data is absent', () => {
    expect(evaluateWeatherAdvisory({ status: 'unavailable' }, 'WALK').level).toBe('UNAVAILABLE')
  })

  it('returns normal for manageable weather', () => {
    expect(evaluateWeatherAdvisory(baseWeather, 'WALK')).toMatchObject({ level: 'NORMAL', reasons: [] })
  })

  it('returns caution for likely rain', () => {
    const result = evaluateWeatherAdvisory({ ...baseWeather, precipitationProbabilityPercent: 70 }, 'WALK')
    expect(result.level).toBe('CAUTION')
    expect(result.reasons).toContainEqual(expect.objectContaining({ code: 'RAIN_LIKELY' }))
  })

  it('returns delay for thunderstorms', () => {
    const result = evaluateWeatherAdvisory({ ...baseWeather, thunderstormProbabilityPercent: 60 }, 'BICYCLE')
    expect(result.level).toBe('DELAY')
    expect(result.reasons[0].code).toBe('THUNDERSTORM_RISK')
  })

  it('treats strong gusts as more severe for cycling', () => {
    const weather = { ...baseWeather, windGustKph: 55 }
    expect(evaluateWeatherAdvisory(weather, 'WALK').level).toBe('CAUTION')
    expect(evaluateWeatherAdvisory(weather, 'BICYCLE').level).toBe('DELAY')
  })

  it.each([
    [{ visibilityKm: 0.9 }, 'DELAY', 'VERY_LOW_VISIBILITY'],
    [{ visibilityKm: 4.9 }, 'CAUTION', 'LOW_VISIBILITY'],
    [{ heatIndexC: 40 }, 'DELAY', 'EXTREME_HEAT'],
    [{ feelsLikeC: 35 }, 'CAUTION', 'HIGH_HEAT'],
    [{ windSpeedKph: 30 }, 'CAUTION', 'STRONG_WIND'],
    [{ uvIndex: 8 }, 'CAUTION', 'HIGH_UV'],
    [{ conditionType: 'THUNDERSTORM', thunderstormProbabilityPercent: 0 }, 'DELAY', 'THUNDERSTORM_RISK'],
  ] as const)('classifies threshold conditions %p', (changes, level, code) => {
    const result = evaluateWeatherAdvisory({ ...baseWeather, ...changes }, 'WALK')
    expect(result.level).toBe(level)
    expect(result.reasons).toContainEqual(expect.objectContaining({ code }))
  })

  it('does not apply UV caution at night', () => {
    expect(evaluateWeatherAdvisory({ ...baseWeather, isDaytime: false, uvIndex: 11 }, 'WALK')).toMatchObject({ level: 'NORMAL', reasons: [] })
  })

  it('keeps all reasons when delay and caution conditions coexist', () => {
    const result = evaluateWeatherAdvisory({ ...baseWeather, thunderstormProbabilityPercent: 50, precipitationProbabilityPercent: 50 }, 'WALK')
    expect(result.level).toBe('DELAY')
    expect(result.reasons.map((reason) => reason.code)).toEqual(['THUNDERSTORM_RISK', 'RAIN_LIKELY'])
  })

  it('aggregates the worst advisory and preserves unique reasons across checkpoints', () => {
    const result = evaluateWeatherAdvisory([{ ...baseWeather, precipitationProbabilityPercent: 70 }, { ...baseWeather, uvIndex: 9 }, { ...baseWeather, visibilityKm: 0.5 }], 'TRANSIT')
    expect(result.level).toBe('DELAY')
    expect(result.reasons.map((reason) => reason.code)).toEqual(['VERY_LOW_VISIBILITY', 'RAIN_LIKELY', 'HIGH_UV'])
  })
})

describe('summarizeHeatUv', () => {
  it('returns maxima and transparent break recommendations across all checkpoints', () => {
    expect(summarizeHeatUv([{ ...baseWeather, feelsLikeC: 36, uvIndex: 9 }, { ...baseWeather, heatIndexC: 41, uvIndex: 5 }])).toEqual({
      status: 'AVAILABLE', maxFeelsLikeC: 36, maxHeatIndexC: 41, maxUvIndex: 9, breakRecommendation: 'RECOMMENDED', reasons: ['At least one checkpoint has extreme apparent heat.'],
    })
  })

  it('handles unavailable, consideration, UV, and normal checkpoint sets', () => {
    expect(summarizeHeatUv([{ status: 'unavailable' }])).toMatchObject({ status: 'UNAVAILABLE', breakRecommendation: 'NONE' })
    expect(summarizeHeatUv([{ ...baseWeather, feelsLikeC: 36 }])).toMatchObject({ breakRecommendation: 'CONSIDER', reasons: ['At least one checkpoint has high apparent heat.'] })
    expect(summarizeHeatUv([{ ...baseWeather, uvIndex: 11 }])).toMatchObject({ breakRecommendation: 'RECOMMENDED', reasons: ['At least one checkpoint has extreme UV exposure.'] })
    expect(summarizeHeatUv([{ ...baseWeather, uvIndex: 8 }])).toMatchObject({ breakRecommendation: 'CONSIDER', reasons: ['At least one checkpoint has high UV exposure.'] })
    expect(summarizeHeatUv([baseWeather])).toMatchObject({ status: 'AVAILABLE', breakRecommendation: 'NONE', reasons: ['No heat or UV break threshold was reached at sampled checkpoints.'] })
  })
})
