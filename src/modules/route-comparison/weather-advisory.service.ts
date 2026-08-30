export type WeatherConditions = {
  status: 'available'
  observedAt: string
  forecastOffsetMinutes: number
  conditionType: string
  condition: string
  isDaytime: boolean
  temperatureC: number
  feelsLikeC: number
  heatIndexC: number
  humidityPercent: number
  uvIndex: number
  precipitationProbabilityPercent: number
  thunderstormProbabilityPercent: number
  windSpeedKph: number
  windGustKph: number
  visibilityKm: number
} | { status: 'unavailable' }

export type WeatherAdvisoryReason = { code: string; message: string }
export type WeatherAdvisory = {
  level: 'NORMAL' | 'CAUTION' | 'DELAY' | 'UNAVAILABLE'
  reasons: WeatherAdvisoryReason[]
  ruleVersion: 'weather-advisory-v1'
}

export function evaluateWeatherAdvisory(weather: WeatherConditions, mode: 'WALK' | 'BICYCLE'): WeatherAdvisory {
  if (weather.status === 'unavailable') return { level: 'UNAVAILABLE', reasons: [{ code: 'WEATHER_UNAVAILABLE', message: 'Current weather conditions are unavailable.' }], ruleVersion: 'weather-advisory-v1' }
  const delay: WeatherAdvisoryReason[] = []
  const caution: WeatherAdvisoryReason[] = []
  if (weather.thunderstormProbabilityPercent >= 50 || weather.conditionType.includes('THUNDER')) delay.push({ code: 'THUNDERSTORM_RISK', message: 'Thunderstorms may make outdoor travel unsafe. Consider delaying your trip.' })
  if (weather.visibilityKm < 1) delay.push({ code: 'VERY_LOW_VISIBILITY', message: 'Visibility is very low. Consider delaying your trip.' })
  else if (weather.visibilityKm < 5) caution.push({ code: 'LOW_VISIBILITY', message: 'Visibility is reduced. Use extra caution.' })
  if (weather.heatIndexC >= 40 || weather.feelsLikeC >= 40) delay.push({ code: 'EXTREME_HEAT', message: 'Current heat conditions are extreme. Consider delaying outdoor travel.' })
  else if (weather.heatIndexC >= 35 || weather.feelsLikeC >= 35) caution.push({ code: 'HIGH_HEAT', message: 'It feels very hot. Reduce exertion and stay hydrated.' })
  if (weather.windGustKph >= 50) (mode === 'BICYCLE' ? delay : caution).push({ code: 'STRONG_WIND_GUSTS', message: mode === 'BICYCLE' ? 'Strong wind gusts may make cycling unsafe. Consider delaying your trip.' : 'Strong wind gusts are expected. Use extra caution.' })
  else if (weather.windSpeedKph >= 30) caution.push({ code: 'STRONG_WIND', message: 'Strong winds may affect travel comfort and control.' })
  if (weather.precipitationProbabilityPercent >= 50) caution.push({ code: 'RAIN_LIKELY', message: 'Rain is likely. Prepare for wet and slippery conditions.' })
  if (weather.isDaytime && weather.uvIndex >= 8) caution.push({ code: 'HIGH_UV', message: 'UV exposure is high. Use sun protection.' })
  return { level: delay.length ? 'DELAY' : caution.length ? 'CAUTION' : 'NORMAL', reasons: delay.length ? delay : caution, ruleVersion: 'weather-advisory-v1' }
}
