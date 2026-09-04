import type { NavigationStep, TransitSummary } from './providers/google-routes.provider.js'
import type { AccessibilityMode, HazardPolicy } from './route-comparison.validation.js'
import type { WeatherConditions } from './weather-advisory.service.js'

export type HazardLevel = 'NONE_REPORTED' | 'LOW' | 'MEDIUM' | 'HIGH'
export type HazardSummary = {
  level: HazardLevel
  reports: Array<{ id: string; category: string; distanceMeters: number; confidence: 'LOW' | 'MEDIUM' | 'HIGH'; confirmations: number; disputes: number }>
  nearbyCount: number
  confirmedCount: number
  confirmedReportSignalScore: number
  fewerConfirmedReportSignals: number
  limitations: string[]
}
export type RouteCandidate = {
  id: string
  durationSeconds: number
  distanceMeters: number
  encodedPolyline: string
  providerLabels: string[]
  averagePm25: number | null
  airQualityTimestamp: string | null
  dataQuality: 'modeled_estimate' | 'partial_estimate' | 'unavailable'
  airQualitySampleCount: number
  airQualityExpectedSampleCount: number
  airQualitySamples: Array<{ latitude: number; longitude: number; pm25: number }>
  hazardSummary: HazardSummary
  heatUv: unknown
  weatherConditions: WeatherConditions[]
  navigationSteps?: NavigationStep[]
  transitSummary?: TransitSummary
}
export type RouteLabel = 'FASTEST' | 'RECOMMENDED' | 'LOWEST_EXPOSURE'
export type RankedRoute = RouteCandidate & {
  labels: RouteLabel[]
  estimatedExposureIndex: number | null
  reductionFromFastestPercent: number | null
  reductionPercent: number | null
  exposureUnit: 'ug_m3_minutes'
  confidence: {
    score: number
    level: 'LOW' | 'MEDIUM' | 'HIGH'
    kind: 'EVIDENCE_COMPLETENESS'
    isProbability: false
    factors: { airQualityCoverage: number; weatherCoverage: number; hazardCoverage: number; routeProvider: number }
    limitations: string[]
  }
  explanation: { summary: string; reasons: string[]; tradeoffs: string[]; limitations: string[]; ruleVersion: 'route-ranking-v2' }
  accessibility: { mode: AccessibilityMode; assessment: 'STANDARD' | 'APPROXIMATION'; reasons: string[]; limitations: string[] }
}

type RankingOptions = { preference: 'balanced' | 'lower-exposure'; sensitiveUser: boolean; hazardPolicy: HazardPolicy; accessibilityMode: AccessibilityMode }
const exposure = (route: RouteCandidate) => route.averagePm25 === null ? null : route.averagePm25 * route.durationSeconds / 60
const compareId = (left: RouteCandidate, right: RouteCandidate) => left.id.localeCompare(right.id)

function confidence(route: RouteCandidate) {
  const airQualityCoverage = Math.round(50 * route.airQualitySampleCount / Math.max(1, route.airQualityExpectedSampleCount))
  const weatherCoverage = Math.round(20 * route.weatherConditions.filter((item) => item.status === 'available').length / Math.max(1, route.weatherConditions.length))
  const factors = { airQualityCoverage, weatherCoverage, hazardCoverage: 15, routeProvider: 15 }
  const score = Object.values(factors).reduce((total, value) => total + value, 0)
  const limitations = [
    ...(route.dataQuality === 'unavailable' ? ['Kualitas udara tidak tersedia untuk rute ini.'] : route.airQualitySampleCount < route.airQualityExpectedSampleCount ? ['Kualitas udara dihitung dari sebagian sampel rute.'] : []),
    ...(weatherCoverage < 20 ? ['Cuaca tidak tersedia pada satu atau beberapa titik sampel.'] : []),
    ...route.hazardSummary.limitations,
  ]
  return { score, level: score >= 80 ? 'HIGH' as const : score >= 55 ? 'MEDIUM' as const : 'LOW' as const, kind: 'EVIDENCE_COMPLETENESS' as const, isProbability: false as const, factors, limitations }
}

export function rankRoutes(routes: RouteCandidate[], options: RankingOptions): RankedRoute[] {
  if (!routes.length) return []
  const byDuration = (left: RouteCandidate, right: RouteCandidate) => left.durationSeconds - right.durationSeconds || compareId(left, right)
  const byExposure = (left: RouteCandidate, right: RouteCandidate) => (exposure(left) ?? Number.POSITIVE_INFINITY) - (exposure(right) ?? Number.POSITIVE_INFINITY) || left.durationSeconds - right.durationSeconds || compareId(left, right)
  const fastest = [...routes].sort(byDuration)[0]
  const measured = routes.filter((route) => route.averagePm25 !== null)
  const strong = measured.filter((route) => route.airQualitySampleCount >= 3)
  const qualityEligible = strong.length ? strong : measured
  const lowestExposure = [...qualityEligible].sort(byExposure)[0]
  const maximumDuration = fastest.durationSeconds * (options.sensitiveUser ? 1.35 : 1.2)
  const strongWithinDuration = strong.filter((route) => route.durationSeconds <= maximumDuration)
  const balancedFallback = measured.length > 0 && options.preference === 'balanced' && !strongWithinDuration.length
  const eligible = strongWithinDuration.length ? strongWithinDuration : [fastest]
  const byBalanced = (left: RouteCandidate, right: RouteCandidate) => {
    if (options.hazardPolicy === 'PREFER_FEWER_REPORTS') {
      const hazard = left.hazardSummary.confirmedReportSignalScore - right.hazardSummary.confirmedReportSignalScore
      if (hazard) return hazard
    }
    return byExposure(left, right)
  }
  const recommended = options.preference === 'lower-exposure' && lowestExposure ? lowestExposure : measured.length ? [...eligible].sort(byBalanced)[0] : fastest
  const fastestExposure = exposure(fastest)
  return routes.map((route): RankedRoute => {
    const rawExposure = exposure(route)
    const estimatedExposureIndex = rawExposure === null ? null : Math.round(rawExposure * 10) / 10
    const labels: RouteLabel[] = []
    if (route.id === fastest.id) labels.push('FASTEST')
    if (route.id === recommended.id) labels.push('RECOMMENDED')
    if (lowestExposure && route.id === lowestExposure.id) labels.push('LOWEST_EXPOSURE')
    const reductionPercent = fastestExposure === null || estimatedExposureIndex === null ? null : fastestExposure === 0 ? 0 : Math.max(0, Math.round((fastestExposure - estimatedExposureIndex) / fastestExposure * 100))
    const routeConfidence = confidence(route)
    const reasons = [
      ...(route.id === recommended.id ? [measured.length === 0 ? 'Dipilih berdasarkan durasi dan sinyal laporan karena kualitas udara tidak tersedia.' : balancedFallback ? 'Tidak ada rute dengan sampel kualitas udara kuat dalam batas durasi seimbang, sehingga rute tercepat dipilih.' : 'Dipilih berdasarkan durasi, sinyal laporan, dan perkiraan paparan.'] : []),
      ...(route.id === fastest.id ? ['Memiliki durasi perkiraan penyedia yang paling singkat.'] : []),
      ...(lowestExposure && route.id === lowestExposure.id ? ['Memiliki perkiraan paparan PM2.5 berdasarkan waktu yang paling rendah.'] : []),
      `${route.hazardSummary.nearbyCount} sinyal laporan komunitas aktif ditemukan dalam jarak 100 meter.`,
    ]
    return {
      ...route,
      labels,
      estimatedExposureIndex,
      reductionFromFastestPercent: reductionPercent,
      reductionPercent,
      exposureUnit: 'ug_m3_minutes',
      confidence: routeConfidence,
      explanation: {
        summary: route.id === recommended.id ? 'Direkomendasikan berdasarkan rute, kondisi lingkungan, dan bukti laporan komunitas yang tersedia.' : 'Alternatif dipertahankan untuk perbandingan.',
        reasons,
        tradeoffs: [...(route.id === recommended.id && balancedFallback ? ['Rute tercepat memiliki bukti kualitas udara yang lebih lemah dari preferensi seimbang; rute lebih lambat tidak dipilih karena melewati batas durasi.'] : []), estimatedExposureIndex === null ? `Perkiraan durasi ${Math.round(route.durationSeconds / 60)} menit; paparan kualitas udara tidak tersedia.` : `Perkiraan durasi ${Math.round(route.durationSeconds / 60)} menit; indeks paparan perkiraan ${estimatedExposureIndex}.`],
        limitations: routeConfidence.limitations,
        ruleVersion: 'route-ranking-v2',
      },
      accessibility: options.accessibilityMode === 'REDUCED_EXERTION' ? {
        mode: options.accessibilityMode,
        assessment: 'APPROXIMATION',
        reasons: [route.transitSummary ? 'Rute transit mengutamakan lebih sedikit berjalan kaki kecuali preferensi transit lain dipilih.' : 'Upaya lebih ringan diperkirakan dari durasi rute dan data penyedia yang tersedia.'],
        limitations: ['Ini bukan rute terverifikasi aman untuk kursi roda atau bebas tangga, serta tidak memverifikasi hambatan, kemiringan, atau ketersediaan lift.'],
      } : {
        mode: options.accessibilityMode,
        assessment: 'STANDARD',
        reasons: ['Perkiraan upaya lebih ringan tidak diminta.'],
        limitations: ['Rute belum diverifikasi aman untuk kursi roda atau bebas tangga.'],
      },
    }
  }).sort((left, right) => left.durationSeconds - right.durationSeconds || left.id.localeCompare(right.id))
}
