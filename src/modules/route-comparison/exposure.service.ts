import type { TransitSummary } from './providers/google-routes.provider.js'
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
  averagePm25: number
  airQualityTimestamp: string
  dataQuality: 'modeled_estimate' | 'partial_estimate'
  airQualitySampleCount: number
  airQualityExpectedSampleCount: number
  airQualitySamples: Array<{ latitude: number; longitude: number; pm25: number }>
  hazardSummary: HazardSummary
  heatUv: unknown
  weatherConditions: WeatherConditions[]
  transitSummary?: TransitSummary
}
export type RouteLabel = 'FASTEST' | 'RECOMMENDED' | 'LOWEST_EXPOSURE'
export type RankedRoute = RouteCandidate & {
  labels: RouteLabel[]
  estimatedExposureIndex: number
  reductionFromFastestPercent: number
  reductionPercent: number
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
const exposure = (route: RouteCandidate) => route.averagePm25 * route.durationSeconds / 60
const compareId = (left: RouteCandidate, right: RouteCandidate) => left.id.localeCompare(right.id)

function confidence(route: RouteCandidate) {
  const airQualityCoverage = Math.round(50 * route.airQualitySampleCount / Math.max(1, route.airQualityExpectedSampleCount))
  const weatherCoverage = Math.round(20 * route.weatherConditions.filter((item) => item.status === 'available').length / Math.max(1, route.weatherConditions.length))
  const factors = { airQualityCoverage, weatherCoverage, hazardCoverage: 15, routeProvider: 15 }
  const score = Object.values(factors).reduce((total, value) => total + value, 0)
  const limitations = [
    ...(route.airQualitySampleCount < route.airQualityExpectedSampleCount ? ['Air quality is based on partial route sampling.'] : []),
    ...(weatherCoverage < 20 ? ['Weather is unavailable at one or more sampled checkpoints.'] : []),
    ...route.hazardSummary.limitations,
  ]
  return { score, level: score >= 80 ? 'HIGH' as const : score >= 55 ? 'MEDIUM' as const : 'LOW' as const, kind: 'EVIDENCE_COMPLETENESS' as const, isProbability: false as const, factors, limitations }
}

export function rankRoutes(routes: RouteCandidate[], options: RankingOptions): RankedRoute[] {
  if (!routes.length) return []
  const byDuration = (left: RouteCandidate, right: RouteCandidate) => left.durationSeconds - right.durationSeconds || compareId(left, right)
  const byExposure = (left: RouteCandidate, right: RouteCandidate) => exposure(left) - exposure(right) || left.durationSeconds - right.durationSeconds || compareId(left, right)
  const fastest = [...routes].sort(byDuration)[0]
  const strong = routes.filter((route) => route.airQualitySampleCount >= 3)
  const qualityEligible = strong.length ? strong : routes
  const lowestExposure = [...qualityEligible].sort(byExposure)[0] ?? fastest
  const maximumDuration = fastest.durationSeconds * (options.sensitiveUser ? 1.35 : 1.2)
  const strongWithinDuration = strong.filter((route) => route.durationSeconds <= maximumDuration)
  const balancedFallback = options.preference === 'balanced' && !strongWithinDuration.length
  const eligible = strongWithinDuration.length ? strongWithinDuration : [fastest]
  const byBalanced = (left: RouteCandidate, right: RouteCandidate) => {
    if (options.hazardPolicy === 'PREFER_FEWER_REPORTS') {
      const hazard = left.hazardSummary.confirmedReportSignalScore - right.hazardSummary.confirmedReportSignalScore
      if (hazard) return hazard
    }
    return byExposure(left, right)
  }
  const recommended = (options.preference === 'lower-exposure' ? lowestExposure : [...eligible].sort(byBalanced)[0]) ?? fastest
  const fastestExposure = exposure(fastest)
  return routes.map((route): RankedRoute => {
    const estimatedExposureIndex = Math.round(exposure(route) * 10) / 10
    const labels: RouteLabel[] = []
    if (route.id === fastest.id) labels.push('FASTEST')
    if (route.id === recommended.id) labels.push('RECOMMENDED')
    if (route.id === lowestExposure.id) labels.push('LOWEST_EXPOSURE')
    const reductionPercent = fastestExposure === 0 ? 0 : Math.max(0, Math.round((fastestExposure - estimatedExposureIndex) / fastestExposure * 100))
    const routeConfidence = confidence(route)
    const reasons = [
      ...(route.id === recommended.id ? [balancedFallback ? 'No route with strong air-quality sampling was within the balanced duration cap, so the fastest route was selected.' : 'Selected by deterministic duration, report-signal, and modeled-exposure rules.'] : []),
      ...(route.id === fastest.id ? ['Has the shortest provider-estimated duration.'] : []),
      ...(route.id === lowestExposure.id ? ['Has the lowest eligible modeled PM2.5-time exposure.'] : []),
      `${route.hazardSummary.nearbyCount} active community report signal${route.hazardSummary.nearbyCount === 1 ? '' : 's'} matched within 100 meters.`,
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
        summary: route.id === recommended.id ? 'Recommended from available route, environment, and community-report evidence.' : 'Alternative retained for comparison.',
        reasons,
        tradeoffs: [...(route.id === recommended.id && balancedFallback ? ['The fastest fallback has weaker air-quality evidence than preferred for balanced ranking; slower candidates were not selected outside the duration cap.'] : []), `Estimated duration is ${Math.round(route.durationSeconds / 60)} minutes; modeled exposure index is ${estimatedExposureIndex}.`],
        limitations: routeConfidence.limitations,
        ruleVersion: 'route-ranking-v2',
      },
      accessibility: options.accessibilityMode === 'REDUCED_EXERTION' ? {
        mode: options.accessibilityMode,
        assessment: 'APPROXIMATION',
        reasons: [route.transitSummary ? 'Transit routing prefers less walking unless an explicit transit preference was supplied.' : 'Lower exertion is approximated from route duration and available provider data.'],
        limitations: ['This is not wheelchair-safe or step-free routing and does not verify barriers, gradients, or lift availability.'],
      } : {
        mode: options.accessibilityMode,
        assessment: 'STANDARD',
        reasons: ['No reduced-exertion approximation was requested.'],
        limitations: ['The route is not verified as wheelchair-safe or step-free.'],
      },
    }
  }).sort((left, right) => left.durationSeconds - right.durationSeconds || left.id.localeCompare(right.id))
}
