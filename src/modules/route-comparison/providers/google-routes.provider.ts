import { z } from 'zod'
import { env } from '../../../config/index.js'
import { AppError } from '../../../middleware/index.js'
import type { RouteComparisonRequest } from '../route-comparison.validation.js'

const locationSchema = z.object({ latLng: z.object({ latitude: z.number(), longitude: z.number() }) })
const stopSchema = z.object({ name: z.string(), location: locationSchema.optional() })
const transitDetailsSchema = z.object({
  stopDetails: z.object({ departureStop: stopSchema.optional(), arrivalStop: stopSchema.optional(), departureTime: z.string().optional(), arrivalTime: z.string().optional() }).optional(),
  headsign: z.string().optional(),
  transitLine: z.object({
    name: z.string().optional(),
    nameShort: z.string().optional(),
    vehicle: z.object({ type: z.string(), name: z.object({ text: z.string() }).optional() }).optional(),
  }).optional(),
  stopCount: z.number().int().nonnegative().optional(),
})
const stepSchema = z.object({
  travelMode: z.string(),
  staticDuration: z.string().regex(/^\d+(?:\.\d+)?s$/).optional(),
  distanceMeters: z.number().nonnegative().optional(),
  startLocation: locationSchema.optional(),
  endLocation: locationSchema.optional(),
  polyline: z.object({ encodedPolyline: z.string().min(1) }).optional(),
  transitDetails: transitDetailsSchema.optional(),
})
const googleErrorSchema = z.object({ error: z.object({ status: z.string().optional() }) })
const responseSchema = z.object({
  routes: z.array(z.object({
    distanceMeters: z.number().nonnegative(),
    duration: z.string().regex(/^\d+(?:\.\d+)?s$/),
    polyline: z.object({ encodedPolyline: z.string().min(1) }),
    routeLabels: z.array(z.string()).optional(),
    warnings: z.array(z.string()).optional(),
    legs: z.array(z.object({ steps: z.array(stepSchema).optional() })).optional(),
  })).min(1),
})

type Station = { name: string; location?: { latitude: number; longitude: number } }
export type TransitSegment = {
  travelMode: string
  durationSeconds?: number
  distanceMeters?: number
  encodedPolyline?: string
  startLocation?: { latitude: number; longitude: number }
  endLocation?: { latitude: number; longitude: number }
  lineName?: string
  lineShortName?: string
  vehicleType?: string
  headsign?: string
  departureTime?: string
  arrivalTime?: string
  departureStop?: Station
  arrivalStop?: Station
  stopCount?: number
}
export type CompositeSegment = Omit<TransitSegment, 'travelMode'> & {
  role: 'FIRST_MILE' | 'WAIT' | 'TRANSIT_RIDE' | 'TRANSFER_WALK' | 'LAST_MILE'
  source: 'GOOGLE_ROUTES' | 'DERIVED_FROM_TRANSIT_SCHEDULE'
  mode: 'BICYCLE' | 'WAIT' | 'TRANSIT' | 'WALK'
  durationSeconds: number
  distanceMeters: number
  location?: { latitude: number; longitude: number }
}
export type TransitSummary = {
  walkingDurationSeconds: number | null
  walkingDistanceMeters: number | null
  transfers: number
  segments: Array<TransitSegment | CompositeSegment>
  stations: Station[]
  preferredTransitModes?: string[]
  actualTransitModes?: string[]
}
export type ProviderRoute = {
  id: string
  durationSeconds: number
  distanceMeters: number
  encodedPolyline: string
  providerLabels: string[]
  warnings?: string[]
  transitSummary?: TransitSummary
  composition?: 'PROVIDER_SEGMENTS'
  scheduleStatus?: 'SCHEDULE_VALIDATED'
  limitations?: string[]
}

type RouteRequest = Pick<RouteComparisonRequest, 'origin' | 'destination' | 'mode' | 'accessibilityMode'> & Partial<Pick<RouteComparisonRequest, 'transitModes' | 'transitPreference'>>
type RouteOptions = { computeAlternativeRoutes?: boolean }

const FIELD_MASK = 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.routeLabels,routes.warnings,routes.legs.steps.travelMode,routes.legs.steps.staticDuration,routes.legs.steps.distanceMeters,routes.legs.steps.startLocation,routes.legs.steps.endLocation,routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.transitDetails.stopDetails.departureStop,routes.legs.steps.transitDetails.stopDetails.arrivalStop,routes.legs.steps.transitDetails.stopDetails.departureTime,routes.legs.steps.transitDetails.stopDetails.arrivalTime,routes.legs.steps.transitDetails.transitLine,routes.legs.steps.transitDetails.headsign,routes.legs.steps.transitDetails.stopCount'

function seconds(duration: string | undefined) {
  return duration ? Number.parseFloat(duration) : 0
}

function station(value: z.infer<typeof stopSchema> | undefined): Station | undefined {
  if (!value) return undefined
  return { name: value.name, ...(value.location ? { location: value.location.latLng } : {}) }
}

function transitSummary(legs: z.infer<typeof responseSchema>['routes'][number]['legs'], preferredTransitModes?: string[]): TransitSummary {
  const steps = legs?.flatMap((leg) => leg.steps ?? []) ?? []
  const segments = steps.map((step): TransitSegment => {
    const departureStop = station(step.transitDetails?.stopDetails?.departureStop)
    const arrivalStop = station(step.transitDetails?.stopDetails?.arrivalStop)
    return {
      travelMode: step.travelMode,
      ...(step.staticDuration ? { durationSeconds: seconds(step.staticDuration) } : {}),
      ...(step.distanceMeters !== undefined ? { distanceMeters: step.distanceMeters } : {}),
      ...(step.polyline ? { encodedPolyline: step.polyline.encodedPolyline } : {}),
      ...(step.startLocation ? { startLocation: step.startLocation.latLng } : {}),
      ...(step.endLocation ? { endLocation: step.endLocation.latLng } : {}),
      ...(step.transitDetails?.transitLine?.name ? { lineName: step.transitDetails.transitLine.name } : {}),
      ...(step.transitDetails?.transitLine?.nameShort ? { lineShortName: step.transitDetails.transitLine.nameShort } : {}),
      ...(step.transitDetails?.transitLine?.vehicle?.type ? { vehicleType: step.transitDetails.transitLine.vehicle.type } : {}),
      ...(step.transitDetails?.headsign ? { headsign: step.transitDetails.headsign } : {}),
      ...(step.transitDetails?.stopDetails?.departureTime ? { departureTime: step.transitDetails.stopDetails.departureTime } : {}),
      ...(step.transitDetails?.stopDetails?.arrivalTime ? { arrivalTime: step.transitDetails.stopDetails.arrivalTime } : {}),
      ...(departureStop ? { departureStop } : {}),
      ...(arrivalStop ? { arrivalStop } : {}),
      ...(step.transitDetails?.stopCount !== undefined ? { stopCount: step.transitDetails.stopCount } : {}),
    }
  })
  const walkingSegments = segments.filter((segment) => segment.travelMode === 'WALK')
  const transitSegments = segments.filter((segment) => segment.travelMode === 'TRANSIT')
  const stations = Array.from(new Map(transitSegments.flatMap((segment) => [segment.departureStop, segment.arrivalStop]).filter((value): value is Station => Boolean(value)).map((value) => [`${value.name}:${value.location?.latitude ?? ''}:${value.location?.longitude ?? ''}`, value])).values())
  return {
    walkingDurationSeconds: walkingSegments.length && walkingSegments.every((segment) => segment.durationSeconds !== undefined) ? walkingSegments.reduce((total, segment) => total + (segment.durationSeconds ?? 0), 0) : null,
    walkingDistanceMeters: walkingSegments.length && walkingSegments.every((segment) => segment.distanceMeters !== undefined) ? walkingSegments.reduce((total, segment) => total + (segment.distanceMeters ?? 0), 0) : null,
    transfers: Math.max(0, transitSegments.length - 1),
    segments,
    stations,
    ...(preferredTransitModes ? { preferredTransitModes, actualTransitModes: Array.from(new Set(transitSegments.flatMap((segment) => segment.vehicleType ? [segment.vehicleType] : []))) } : {}),
  }
}

async function requestRoutes(input: RouteRequest, departureOffsetMinutes: number, now: Date, options: RouteOptions): Promise<ProviderRoute[]> {
  const apiKey = env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) throw new AppError(503, 'route_provider_not_configured', 'The route provider is not configured.', false)
  const isTransit = input.mode === 'TRANSIT'
  const routingPreference = input.transitPreference ?? (input.accessibilityMode === 'REDUCED_EXERTION' ? 'LESS_WALKING' : undefined)
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify({
      origin: { location: { latLng: input.origin } },
      destination: { location: { latLng: input.destination } },
      travelMode: input.mode,
      computeAlternativeRoutes: options.computeAlternativeRoutes ?? true,
      polylineQuality: 'HIGH_QUALITY',
      languageCode: 'en',
      units: 'METRIC',
      ...(isTransit ? {
        departureTime: new Date(now.getTime() + departureOffsetMinutes * 60_000).toISOString(),
        ...((input.transitModes || routingPreference) ? { transitPreferences: {
          ...(input.transitModes ? { allowedTravelModes: input.transitModes } : {}),
          ...(routingPreference ? { routingPreference } : {}),
        } } : {}),
      } : {}),
    }),
  }).catch(() => { throw new AppError(503, 'route_provider_unavailable', 'Routes are temporarily unavailable.', true) })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const parsedError = googleErrorSchema.safeParse(payload)
    if (parsedError.success && parsedError.data.error.status === 'INVALID_ARGUMENT') throw new AppError(400, 'route_provider_invalid_argument', 'The route provider rejected the route request fields. Check travel mode and transit options.', false)
    throw new AppError(response.status === 429 ? 503 : 502, 'route_provider_error', 'The route provider could not complete this request.', response.status >= 500 || response.status === 429)
  }
  if (typeof payload === 'object' && payload !== null && (!('routes' in payload) || Array.isArray(payload.routes) && payload.routes.length === 0)) {
    if (input.mode === 'BICYCLE') throw new AppError(422, 'cycling_route_unavailable', 'Google Maps does not provide a cycling route for this trip. Try walking mode.', false)
    if (input.mode === 'WALK') throw new AppError(422, 'walking_route_unavailable', 'No walking route is available for this trip.', false)
    if (input.mode === 'TRANSIT') throw new AppError(422, 'transit_route_unavailable', 'No transit route is available for this trip and departure time.', false)
  }
  const parsed = responseSchema.safeParse(payload)
  if (!parsed.success) throw new AppError(502, 'invalid_route_response', 'The route provider returned an invalid response.', true)
  return parsed.data.routes.map((route, index) => ({
    id: `route_${index + 1}`,
    durationSeconds: seconds(route.duration),
    distanceMeters: route.distanceMeters,
    encodedPolyline: route.polyline.encodedPolyline,
    providerLabels: route.routeLabels ?? [],
    ...(route.warnings ? { warnings: route.warnings } : {}),
    ...(isTransit ? { transitSummary: transitSummary(route.legs, input.transitModes) } : {}),
  }))
}

export function getRoutes(input: RouteRequest, departureOffsetMinutes = 0, now = new Date(), options: RouteOptions = {}) {
  return requestRoutes(input, departureOffsetMinutes, now, options)
}
