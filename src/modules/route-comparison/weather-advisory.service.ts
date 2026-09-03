export type WeatherConditions = {
  status: 'available'
  observedAt: string
  targetTime?: string
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
  ruleVersion: 'weather-advisory-v2'
}

function reasonsFor(weather: WeatherConditions, mode: 'WALK' | 'BICYCLE' | 'TRANSIT') {
  if (weather.status === 'unavailable') return { delay: [], caution: [], unavailable: [{ code: 'WEATHER_UNAVAILABLE', message: 'Weather conditions are unavailable for one or more route checkpoints.' }] }
  const delay: WeatherAdvisoryReason[] = []
  const caution: WeatherAdvisoryReason[] = []
  if (weather.thunderstormProbabilityPercent >= 50 || weather.conditionType.includes('THUNDER')) delay.push({ code: 'THUNDERSTORM_RISK', message: 'Thunderstorms may make outdoor portions of this trip unsuitable. Consider delaying.' })
  if (weather.visibilityKm < 1) delay.push({ code: 'VERY_LOW_VISIBILITY', message: 'Visibility is very low. Consider delaying outdoor travel.' })
  else if (weather.visibilityKm < 5) caution.push({ code: 'LOW_VISIBILITY', message: 'Visibility is reduced. Use extra caution.' })
  if (weather.heatIndexC >= 40 || weather.feelsLikeC >= 40) delay.push({ code: 'EXTREME_HEAT', message: 'Heat conditions are extreme at a route checkpoint. Consider delaying outdoor travel.' })
  else if (weather.heatIndexC >= 35 || weather.feelsLikeC >= 35) caution.push({ code: 'HIGH_HEAT', message: 'It feels very hot at a route checkpoint. Reduce exertion and stay hydrated.' })
  if (weather.windGustKph >= 50) (mode === 'BICYCLE' ? delay : caution).push({ code: 'STRONG_WIND_GUSTS', message: mode === 'BICYCLE' ? 'Strong wind gusts may make cycling unsuitable. Consider delaying.' : 'Strong wind gusts are expected. Use extra caution.' })
  else if (weather.windSpeedKph >= 30) caution.push({ code: 'STRONG_WIND', message: 'Strong winds may affect travel comfort and control.' })
  if (weather.precipitationProbabilityPercent >= 50) caution.push({ code: 'RAIN_LIKELY', message: 'Rain is likely. Prepare for wet and slippery conditions.' })
  if (weather.isDaytime && weather.uvIndex >= 8) caution.push({ code: 'HIGH_UV', message: 'UV exposure is high at a route checkpoint. Use sun protection.' })
  return { delay, caution, unavailable: [] }
}

export function evaluateWeatherAdvisory(weather: WeatherConditions | WeatherConditions[], mode: 'WALK' | 'BICYCLE' | 'TRANSIT'): WeatherAdvisory {
  const conditions = Array.isArray(weather) ? weather : [weather]
  const all = conditions.map((item) => reasonsFor(item, mode))
  const unique = (reasons: WeatherAdvisoryReason[]) => Array.from(new Map(reasons.map((reason) => [reason.code, reason])).values())
  const delay = unique(all.flatMap((item) => item.delay))
  const caution = unique(all.flatMap((item) => item.caution))
  const unavailable = unique(all.flatMap((item) => item.unavailable))
  const reasons = unique([...delay, ...caution, ...unavailable])
  if (delay.length) return { level: 'DELAY', reasons, ruleVersion: 'weather-advisory-v2' }
  if (caution.length) return { level: 'CAUTION', reasons, ruleVersion: 'weather-advisory-v2' }
  if (unavailable.length === conditions.length) return { level: 'UNAVAILABLE', reasons, ruleVersion: 'weather-advisory-v2' }
  return { level: 'NORMAL', reasons, ruleVersion: 'weather-advisory-v2' }
}

export function summarizeHeatUv(weather: WeatherConditions[]) {
  const available = weather.filter((item): item is Extract<WeatherConditions, { status: 'available' }> => item.status === 'available')
  if (!available.length) return { status: 'UNAVAILABLE' as const, maxFeelsLikeC: null, maxHeatIndexC: null, maxUvIndex: null, breakRecommendation: 'NONE' as const, reasons: ['Weather heat and UV data are unavailable.'] }
  const maxFeelsLikeC = Math.max(...available.map((item) => item.feelsLikeC))
  const maxHeatIndexC = Math.max(...available.map((item) => item.heatIndexC))
  const maxUvIndex = Math.max(...available.map((item) => item.uvIndex))
  const reasons: string[] = []
  let breakRecommendation: 'NONE' | 'CONSIDER' | 'RECOMMENDED' = 'NONE'
  if (maxFeelsLikeC >= 40 || maxHeatIndexC >= 40 || maxUvIndex >= 11) {
    breakRecommendation = 'RECOMMENDED'
    if (Math.max(maxFeelsLikeC, maxHeatIndexC) >= 40) reasons.push('At least one checkpoint has extreme apparent heat.')
    if (maxUvIndex >= 11) reasons.push('At least one checkpoint has extreme UV exposure.')
  } else if (maxFeelsLikeC >= 35 || maxHeatIndexC >= 35 || maxUvIndex >= 8) {
    breakRecommendation = 'CONSIDER'
    if (Math.max(maxFeelsLikeC, maxHeatIndexC) >= 35) reasons.push('At least one checkpoint has high apparent heat.')
    if (maxUvIndex >= 8) reasons.push('At least one checkpoint has high UV exposure.')
  }
  if (!reasons.length) reasons.push('No heat or UV break threshold was reached at sampled checkpoints.')
  return { status: 'AVAILABLE' as const, maxFeelsLikeC, maxHeatIndexC, maxUvIndex, breakRecommendation, reasons }
}
