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
  if (weather.status === 'unavailable') return { delay: [], caution: [], unavailable: [{ code: 'WEATHER_UNAVAILABLE', message: 'Kondisi cuaca tidak tersedia pada satu atau beberapa titik rute.' }] }
  const delay: WeatherAdvisoryReason[] = []
  const caution: WeatherAdvisoryReason[] = []
  if (weather.thunderstormProbabilityPercent >= 50 || weather.conditionType.includes('THUNDER')) delay.push({ code: 'THUNDERSTORM_RISK', message: 'Badai petir dapat membuat bagian perjalanan di luar ruangan tidak aman. Pertimbangkan untuk menunda.' })
  if (weather.visibilityKm < 1) delay.push({ code: 'VERY_LOW_VISIBILITY', message: 'Jarak pandang sangat rendah. Pertimbangkan untuk menunda perjalanan luar ruangan.' })
  else if (weather.visibilityKm < 5) caution.push({ code: 'LOW_VISIBILITY', message: 'Jarak pandang berkurang. Tingkatkan kewaspadaan.' })
  if (weather.heatIndexC >= 40 || weather.feelsLikeC >= 40) delay.push({ code: 'EXTREME_HEAT', message: 'Kondisi panas ekstrem terdeteksi pada titik rute. Pertimbangkan untuk menunda perjalanan luar ruangan.' })
  else if (weather.heatIndexC >= 35 || weather.feelsLikeC >= 35) caution.push({ code: 'HIGH_HEAT', message: 'Suhu terasa sangat panas pada titik rute. Kurangi aktivitas dan tetap terhidrasi.' })
  if (weather.windGustKph >= 50) (mode === 'BICYCLE' ? delay : caution).push({ code: 'STRONG_WIND_GUSTS', message: mode === 'BICYCLE' ? 'Hembusan angin kencang dapat membuat bersepeda tidak aman. Pertimbangkan untuk menunda.' : 'Hembusan angin kencang diperkirakan terjadi. Tingkatkan kewaspadaan.' })
  else if (weather.windSpeedKph >= 30) caution.push({ code: 'STRONG_WIND', message: 'Angin kencang dapat memengaruhi kenyamanan dan kendali perjalanan.' })
  if (weather.precipitationProbabilityPercent >= 50) caution.push({ code: 'RAIN_LIKELY', message: 'Hujan mungkin terjadi. Bersiaplah menghadapi kondisi basah dan licin.' })
  if (weather.isDaytime && weather.uvIndex >= 8) caution.push({ code: 'HIGH_UV', message: 'Paparan UV tinggi pada titik rute. Gunakan pelindung dari sinar matahari.' })
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
  if (!available.length) return { status: 'UNAVAILABLE' as const, maxFeelsLikeC: null, maxHeatIndexC: null, maxUvIndex: null, breakRecommendation: 'NONE' as const, reasons: ['Data panas dan UV tidak tersedia.'] }
  const maxFeelsLikeC = Math.max(...available.map((item) => item.feelsLikeC))
  const maxHeatIndexC = Math.max(...available.map((item) => item.heatIndexC))
  const maxUvIndex = Math.max(...available.map((item) => item.uvIndex))
  const reasons: string[] = []
  let breakRecommendation: 'NONE' | 'CONSIDER' | 'RECOMMENDED' = 'NONE'
  if (maxFeelsLikeC >= 40 || maxHeatIndexC >= 40 || maxUvIndex >= 11) {
    breakRecommendation = 'RECOMMENDED'
    if (Math.max(maxFeelsLikeC, maxHeatIndexC) >= 40) reasons.push('Setidaknya satu titik memiliki suhu terasa ekstrem.')
    if (maxUvIndex >= 11) reasons.push('Setidaknya satu titik memiliki paparan UV ekstrem.')
  } else if (maxFeelsLikeC >= 35 || maxHeatIndexC >= 35 || maxUvIndex >= 8) {
    breakRecommendation = 'CONSIDER'
    if (Math.max(maxFeelsLikeC, maxHeatIndexC) >= 35) reasons.push('Setidaknya satu titik memiliki suhu terasa tinggi.')
    if (maxUvIndex >= 8) reasons.push('Setidaknya satu titik memiliki paparan UV tinggi.')
  }
  if (!reasons.length) reasons.push('Tidak ada ambang istirahat akibat panas atau UV yang tercapai pada titik sampel.')
  return { status: 'AVAILABLE' as const, maxFeelsLikeC, maxHeatIndexC, maxUvIndex, breakRecommendation, reasons }
}
