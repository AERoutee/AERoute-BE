export type RouteCandidate = {
  id: string
  durationSeconds: number
  distanceMeters: number
  encodedPolyline: string
  averagePm25: number
  airQualityTimestamp: string
  dataQuality: 'modeled_estimate' | 'partial_estimate'
  airQualitySamples: Array<{ latitude: number; longitude: number; pm25: number }>
}

export type RouteLabel = 'FASTEST' | 'RECOMMENDED' | 'LOWEST_EXPOSURE'

export type RankedRoute = RouteCandidate & {
  labels: RouteLabel[]
  estimatedExposureIndex: number
  reductionFromFastestPercent: number
  exposureUnit: 'ug_m3_minutes'
}

type RankingOptions = {
  preference: 'balanced' | 'lower-exposure'
  sensitiveUser: boolean
}

export function rankRoutes(routes: RouteCandidate[], options: RankingOptions): RankedRoute[] {
  if (!routes.length) return []
  const exposure = (route: RouteCandidate) => route.averagePm25 * route.durationSeconds / 60
  const fastest = routes.reduce((selected, route) => route.durationSeconds < selected.durationSeconds ? route : selected)
  const lowestExposure = routes.reduce((selected, route) => exposure(route) < exposure(selected) ? route : selected)
  const maximumDuration = fastest.durationSeconds * (options.sensitiveUser ? 1.35 : 1.2)
  const eligible = routes.filter((route) => route.durationSeconds <= maximumDuration)
  const balanced = eligible.reduce((selected, route) => exposure(route) < exposure(selected) ? route : selected)
  const recommended = options.preference === 'lower-exposure' ? lowestExposure : balanced
  const fastestExposure = exposure(fastest)

  return routes.map((route) => {
    const estimatedExposureIndex = Math.round(exposure(route) * 10) / 10
    const labels: RouteLabel[] = []
    if (route.id === fastest.id) labels.push('FASTEST')
    if (route.id === recommended.id) labels.push('RECOMMENDED')
    if (route.id === lowestExposure.id) labels.push('LOWEST_EXPOSURE')
    return {
      ...route,
      labels,
      estimatedExposureIndex,
      reductionFromFastestPercent: fastestExposure === 0 ? 0 : Math.max(0, Math.round((fastestExposure - estimatedExposureIndex) / fastestExposure * 100)),
      exposureUnit: 'ug_m3_minutes' as const,
    }
  }).sort((left, right) => left.durationSeconds - right.durationSeconds)
}
