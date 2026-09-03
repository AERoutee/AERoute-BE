import { z } from 'zod'
import { env } from '../../../config/index.js'
import { AppError } from '../../../middleware/index.js'

const PLACE_ID = /^[A-Za-z0-9_-]{1,256}$/u
const PLACE_PHOTO_NAME = /^places\/[A-Za-z0-9_-]{1,256}\/photos\/[A-Za-z0-9_-]{1,512}$/u
const PLACE_PHOTO_MAX_BYTES = 3 * 1024 * 1024
const PLACE_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function safeUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return undefined
  try {
    const normalized = value.startsWith('//') ? `https:${value}` : value
    return new URL(normalized).protocol === 'https:' ? normalized : undefined
  } catch {
    return undefined
  }
}

function safeGoogleUrl(value: unknown) {
  const safe = safeUrl(value)
  if (!safe) return undefined
  const hostname = new URL(safe).hostname.toLowerCase()
  return hostname === 'google.com' || hostname.endsWith('.google.com') ? safe : undefined
}

const attributionSchema = z.object({ displayName: z.string().max(256), uri: z.unknown().optional(), photoUri: z.unknown().optional() }).transform((value) => ({ displayName: value.displayName, ...(safeUrl(value.uri) ? { uri: safeUrl(value.uri) } : {}), ...(safeUrl(value.photoUri) ? { photoUri: safeUrl(value.photoUri) } : {}) }))
const photoSchema = z.object({
  name: z.string().regex(PLACE_PHOTO_NAME),
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
  googleMapsUri: z.unknown().optional(),
  flagContentUri: z.unknown().optional(),
  authorAttributions: z.array(z.unknown()).max(20).optional(),
}).transform(({ googleMapsUri, flagContentUri, authorAttributions: values, ...photo }) => {
  const authorAttributions = values?.flatMap((value) => {
    const parsed = attributionSchema.safeParse(value)
    return parsed.success ? [parsed.data] : []
  })
  const safeGoogleMapsUri = safeGoogleUrl(googleMapsUri)
  const safeFlagContentUri = safeGoogleUrl(flagContentUri)
  return { ...photo, ...(safeGoogleMapsUri ? { googleMapsUri: safeGoogleMapsUri } : {}), ...(safeFlagContentUri ? { flagContentUri: safeFlagContentUri } : {}), ...(authorAttributions?.length ? { authorAttributions } : {}) }
})

function photo(value: unknown) {
  const parsed = photoSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function photos(values: unknown[] | undefined) {
  return values?.flatMap((value) => {
    const parsed = photo(value)
    return parsed ? [parsed] : []
  }).slice(0, 3)
}
const accessibilitySchema = z.object({
  wheelchairAccessibleEntrance: z.boolean().optional(),
  wheelchairAccessibleParking: z.boolean().optional(),
  wheelchairAccessibleRestroom: z.boolean().optional(),
  wheelchairAccessibleSeating: z.boolean().optional(),
}).optional()
const parkingSchema = z.object({
  freeParkingLot: z.boolean().optional(),
  paidParkingLot: z.boolean().optional(),
  freeStreetParking: z.boolean().optional(),
  paidStreetParking: z.boolean().optional(),
  valetParking: z.boolean().optional(),
  freeGarageParking: z.boolean().optional(),
  paidGarageParking: z.boolean().optional(),
}).optional()
const placeSchema = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }),
  formattedAddress: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  types: z.array(z.string()).optional(),
  currentOpeningHours: z.object({ openNow: z.boolean().optional() }).passthrough().optional(),
  accessibilityOptions: accessibilitySchema,
  restroom: z.boolean().optional(),
  parkingOptions: parkingSchema,
  googleMapsUri: z.unknown().optional(),
  photos: z.array(z.unknown()).optional(),
  movedPlaceId: z.string().regex(PLACE_ID).optional(),
})
const responseSchema = z.object({ places: z.array(placeSchema).optional() })

export type RestStopCandidate = {
  id: string
  name: string
  formattedAddress?: string
  location: { latitude: number; longitude: number }
  types: string[]
  openNow?: boolean
  restroom?: boolean
  accessibility?: {
    wheelchairAccessibleEntrance?: boolean
    wheelchairAccessibleParking?: boolean
    wheelchairAccessibleRestroom?: boolean
    wheelchairAccessibleSeating?: boolean
  }
  googleMapsUri?: string
  photos?: Array<z.infer<typeof photoSchema>>
  associationId?: string
  safetyVerified: false
}

export type RestStopResult = { status: 'AVAILABLE'; candidates: RestStopCandidate[] } | { status: 'UNAVAILABLE'; candidates: []; warning: string }
export type TransitStopDetailsInput = { name: string; latitude: number; longitude: number }
export type TransitStopDetailsResult = { status: 'AVAILABLE'; place: RestStopCandidate & { parkingOptions?: z.infer<typeof parkingSchema> } } | { status: 'NOT_FOUND' }
const FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.currentOpeningHours,places.accessibilityOptions,places.restroom,places.googleMapsUri,places.photos'
const TRANSIT_STOP_FIELD_MASK = 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.currentOpeningHours,places.accessibilityOptions,places.restroom,places.parkingOptions,places.googleMapsUri,places.photos'
const PLACE_DETAILS_FIELD_MASK = `${TRANSIT_STOP_FIELD_MASK.replaceAll('places.', '')},movedPlaceId`
const TRANSIT_TYPES = new Set(['transit_station', 'transit_stop', 'bus_station', 'bus_stop', 'train_station', 'subway_station', 'light_rail_station', 'tram_stop'])

function distanceMeters(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }) {
  const radians = Math.PI / 180
  const latitude = (right.latitude - left.latitude) * radians
  const longitude = (right.longitude - left.longitude) * radians
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(left.latitude * radians) * Math.cos(right.latitude * radians) * Math.sin(longitude / 2) ** 2
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function normalizedName(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en')
}

function mappedPlace(place: z.infer<typeof placeSchema>) {
  const placePhotos = photos(place.photos)
  return {
    id: place.id,
    name: place.displayName.text,
    ...(place.formattedAddress ? { formattedAddress: place.formattedAddress } : {}),
    location: place.location,
    types: place.types ?? [],
    ...(place.currentOpeningHours?.openNow !== undefined ? { openNow: place.currentOpeningHours.openNow } : {}),
    ...(place.restroom !== undefined ? { restroom: place.restroom } : {}),
    ...(place.accessibilityOptions && Object.values(place.accessibilityOptions).some((value) => value !== undefined) ? { accessibility: place.accessibilityOptions } : {}),
    ...(place.parkingOptions && Object.values(place.parkingOptions).some((value) => value !== undefined) ? { parkingOptions: place.parkingOptions } : {}),
    ...(safeGoogleUrl(place.googleMapsUri) ? { googleMapsUri: safeGoogleUrl(place.googleMapsUri) } : {}),
    ...(placePhotos?.length ? { photos: placePhotos } : {}),
    safetyVerified: false as const,
  }
}

export async function getTransitStopDetails(input: TransitStopDetailsInput): Promise<TransitStopDetailsResult> {
  const apiKey = env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) throw new AppError(503, 'transit_stop_details_not_configured', 'Transit stop details are not configured.', false)
  let response: Response
  try {
    response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': TRANSIT_STOP_FIELD_MASK },
      body: JSON.stringify({ textQuery: input.name, pageSize: 5, languageCode: 'en', locationBias: { circle: { center: { latitude: input.latitude, longitude: input.longitude }, radius: 250 } } }),
    })
  } catch {
    throw new AppError(503, 'transit_stop_details_unavailable', 'Transit stop details are temporarily unavailable.', true)
  }
  if (!response.ok) {
    if (response.status === 429 || response.status >= 500) throw new AppError(503, 'transit_stop_details_unavailable', 'Transit stop details are temporarily unavailable.', true)
    throw new AppError(502, 'transit_stop_details_provider_error', 'Transit stop details provider returned an error.', false)
  }
  const parsed = responseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new AppError(502, 'invalid_transit_stop_details_response', 'Transit stop details provider returned an invalid response.', false)
  const requestedLocation = { latitude: input.latitude, longitude: input.longitude }
  const requestedName = normalizedName(input.name)
  const selected = (parsed.data.places ?? []).map((place, index) => ({ place, index, distance: distanceMeters(requestedLocation, place.location), exact: normalizedName(place.displayName.text) === requestedName }))
    .filter(({ place, distance }) => distance <= 250 && (place.types ?? []).some((type) => TRANSIT_TYPES.has(type)))
    .sort((left, right) => Number(right.exact) - Number(left.exact) || left.index - right.index || left.distance - right.distance)[0]?.place
  return selected ? { status: 'AVAILABLE', place: mappedPlace(selected) } : { status: 'NOT_FOUND' }
}

export async function getPlaceDetails(placeId: string, visited = new Set<string>()): Promise<TransitStopDetailsResult> {
  if (!PLACE_ID.test(placeId) || visited.has(placeId)) throw new AppError(502, 'invalid_place_id', 'Stored Place ID is invalid.', false)
  visited.add(placeId)
  const apiKey = env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) throw new AppError(503, 'transit_stop_details_not_configured', 'Transit stop details are not configured.', false)
  let response: Response
  try {
    response = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, { method: 'GET', signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS), headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': PLACE_DETAILS_FIELD_MASK } })
  } catch {
    throw new AppError(503, 'transit_stop_details_unavailable', 'Transit stop details are temporarily unavailable.', true)
  }
  if (!response.ok) {
    if (response.status === 404) return { status: 'NOT_FOUND' }
    if (response.status === 429 || response.status >= 500) throw new AppError(503, 'transit_stop_details_unavailable', 'Transit stop details are temporarily unavailable.', true)
    throw new AppError(502, 'transit_stop_details_provider_error', 'Transit stop details provider returned an error.', false)
  }
  const parsed = placeSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new AppError(502, 'invalid_transit_stop_details_response', 'Transit stop details provider returned an invalid response.', false)
  if (parsed.data.movedPlaceId) return getPlaceDetails(parsed.data.movedPlaceId, visited)
  return { status: 'AVAILABLE', place: mappedPlace(parsed.data) }
}

async function readPlacePhotoBody(response: Response) {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > PLACE_PHOTO_MAX_BYTES) {
      await reader.cancel()
      throw new AppError(502, 'place_photo_too_large', 'Place photo exceeds the size limit.', false)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks, length)
}

export async function getPlacePhoto(name: string) {
  if (!PLACE_PHOTO_NAME.test(name)) throw new AppError(400, 'validation_error', 'Place photo name is invalid.', false)
  const apiKey = env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) throw new AppError(503, 'place_photo_not_configured', 'Place photos are not configured.', false)
  let response: Response
  try {
    response = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=640&maxHeightPx=360&skipHttpRedirect=false&key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS), redirect: 'follow' })
  } catch {
    throw new AppError(503, 'place_photo_provider_unavailable', 'Place photo is temporarily unavailable.', true)
  }
  if (!response.ok) {
    if (response.status === 400 || response.status === 404 || response.status === 410) throw new AppError(404, 'place_photo_unavailable', 'Place photo is unavailable.', false)
    if (response.status === 429 || response.status >= 500) throw new AppError(503, 'place_photo_provider_unavailable', 'Place photo is temporarily unavailable.', true)
    throw new AppError(502, 'place_photo_provider_error', 'Place photo provider returned an error.', false)
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!PLACE_PHOTO_TYPES.has(contentType)) throw new AppError(502, 'invalid_place_photo_response', 'Place photo provider returned an invalid image.', false)
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > PLACE_PHOTO_MAX_BYTES) throw new AppError(502, 'place_photo_too_large', 'Place photo exceeds the size limit.', false)
  let body: Buffer
  try {
    body = await readPlacePhotoBody(response)
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError(503, 'place_photo_provider_unavailable', 'Place photo is temporarily unavailable.', true)
  }
  return { body, contentType }
}

export async function getRestStopCandidates(encodedPolyline: string): Promise<RestStopResult> {
  const apiKey = env.GOOGLE_MAPS_SERVER_KEY
  if (!apiKey) return { status: 'UNAVAILABLE', candidates: [], warning: 'Rest-stop candidates are unavailable because Places API is not configured.' }
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify({ textQuery: 'public rest area restroom cafe park', pageSize: 5, searchAlongRouteParameters: { polyline: { encodedPolyline } } }),
    })
    if (!response.ok) throw new AppError(response.status === 429 ? 503 : 502, 'places_provider_error', 'Rest-stop candidates are unavailable.', response.status >= 500 || response.status === 429)
    const parsed = responseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) throw new AppError(502, 'invalid_places_response', 'Places service returned an invalid response.', true)
    return {
      status: 'AVAILABLE',
      candidates: (parsed.data.places ?? []).slice(0, 5).map(mappedPlace),
    }
  } catch {
    return { status: 'UNAVAILABLE', candidates: [], warning: 'Rest-stop candidates are temporarily unavailable.' }
  }
}
