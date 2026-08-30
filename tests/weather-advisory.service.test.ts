import { evaluateWeatherAdvisory, type WeatherConditions } from '../src/modules/route-comparison/weather-advisory.service'

const baseWeather: Extract<WeatherConditions, { status: 'available' }> = {
  status: 'available',
  observedAt: new Date(0).toISOString(),
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
})
