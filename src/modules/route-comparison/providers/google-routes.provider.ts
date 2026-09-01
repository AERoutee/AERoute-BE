import { z } from 'zod'
import { env } from '../../../config/index.js'
import { AppError } from '../../../middleware/index.js'
import type { RouteComparisonRequest } from '../route-comparison.validation.js'

const responseSchema = z.object({
  routes: z.array(z.object({
    distanceMeters: z.number().nonnegative(),
    duration: z.string().regex(/^\d+(?:\.\d+)?s$/),
    polyline: z.object({ encodedPolyline: z.string().min(1) }),
    routeLabels: z.array(z.string()).optional(),
  })).min(1),
})

export type ProviderRoute = {
  id: string
  durationSeconds: number
  distanceMeters: number
  encodedPolyline: string
}

export async function getRoutes(input: RouteComparisonRequest): Promise<ProviderRoute[]> {
  const apiKey = env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) throw new AppError(503, 'route_provider_not_configured', 'The route provider is not configured.', false)
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS),
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.routeLabels',
    },
    body: JSON.stringify({
      origin: { location: { latLng: input.origin } },
      destination: { location: { latLng: input.destination } },
      travelMode: input.mode === 'BICYCLE' ? 'BICYCLE' : 'WALK',
      computeAlternativeRoutes: true,
      polylineQuality: 'HIGH_QUALITY',
      languageCode: 'en',
      units: 'METRIC',
    }),
  }).catch(() => { throw new AppError(503, 'route_provider_unavailable', 'Routes are temporarily unavailable.', true) })

  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new AppError(response.status === 429 ? 503 : 502, 'route_provider_error', 'The route provider could not complete this request.', response.status >= 500 || response.status === 429)
  if (input.mode === 'BICYCLE' && typeof payload === 'object' && payload !== null && (!('routes' in payload) || Array.isArray(payload.routes) && payload.routes.length === 0)) throw new AppError(422, 'cycling_route_unavailable', 'Google Maps does not provide a cycling route for this trip. Try walking mode.', false)
  const parsed = responseSchema.safeParse(payload)
  if (!parsed.success) throw new AppError(502, 'invalid_route_response', 'The route provider returned an invalid response.', true)
  return parsed.data.routes.map((route, index) => ({ id: `route_${index + 1}`, durationSeconds: Number.parseFloat(route.duration), distanceMeters: route.distanceMeters, encodedPolyline: route.polyline.encodedPolyline }))
}
