export type GeoPoint = { latitude: number; longitude: number }
export type GeoBounds = { north: number; south: number; east: number; west: number }

const EARTH_RADIUS_METERS = 6_371_008.8
const radians = (degrees: number) => degrees * Math.PI / 180
const normalizeLongitude = (longitude: number) => ((longitude + 180) % 360 + 360) % 360 - 180
const longitudeDelta = (from: number, to: number) => normalizeLongitude(to - from)

function decodeValue(encoded: string, start: number) {
  let result = 0
  let shift = 0
  let index = start
  while (index < encoded.length) {
    const byte = encoded.charCodeAt(index) - 63
    if (byte < 0 || byte > 63 || shift > 30) throw new RangeError('Malformed encoded polyline.')
    result += (byte & 0x1f) * 2 ** shift
    index += 1
    if (byte < 0x20) return { value: result % 2 === 1 ? -(Math.floor(result / 2) + 1) : result / 2, index }
    shift += 5
  }
  throw new RangeError('Truncated encoded polyline.')
}

export function decodePolyline(encoded: string): GeoPoint[] {
  const points: GeoPoint[] = []
  let index = 0
  let latitude = 0
  let longitude = 0
  while (index < encoded.length) {
    const latitudeDelta = decodeValue(encoded, index)
    const longitudeDelta = decodeValue(encoded, latitudeDelta.index)
    latitude += latitudeDelta.value
    longitude += longitudeDelta.value
    index = longitudeDelta.index
    const point = { latitude: latitude / 1e5, longitude: longitude / 1e5 }
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) throw new RangeError('Encoded polyline contains invalid coordinates.')
    points.push(point)
  }
  return points
}

function encodeValue(value: number) {
  let remaining = value < 0 ? ~(value << 1) : value << 1
  let encoded = ''
  while (remaining >= 0x20) {
    encoded += String.fromCharCode((0x20 | remaining & 0x1f) + 63)
    remaining >>>= 5
  }
  return encoded + String.fromCharCode(remaining + 63)
}

export function encodePolyline(points: GeoPoint[]) {
  let latitude = 0
  let longitude = 0
  return points.map((point) => {
    const nextLatitude = Math.round(point.latitude * 1e5)
    const nextLongitude = Math.round(point.longitude * 1e5)
    if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude) || Math.abs(point.latitude) > 90 || Math.abs(point.longitude) > 180) throw new RangeError('Polyline contains invalid coordinates.')
    const encoded = encodeValue(nextLatitude - latitude) + encodeValue(nextLongitude - longitude)
    latitude = nextLatitude
    longitude = nextLongitude
    return encoded
  }).join('')
}

export function distanceMeters(left: GeoPoint, right: GeoPoint) {
  const latitudeDelta = radians(right.latitude - left.latitude)
  const longitudeDeltaRadians = radians(longitudeDelta(left.longitude, right.longitude))
  const latitudeA = radians(left.latitude)
  const latitudeB = radians(right.latitude)
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDeltaRadians / 2) ** 2
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
}

export function samplePolyline(points: GeoPoint[], count: number): GeoPoint[] {
  if (!Number.isInteger(count) || count < 1 || !points.length) return []
  if (points.length === 1 || count === 1) return [points[0]]
  const cumulative = [0]
  for (let index = 1; index < points.length; index += 1) cumulative.push(cumulative[index - 1] + distanceMeters(points[index - 1], points[index]))
  const total = cumulative.at(-1)!
  if (total === 0) return [points[0]]
  return Array.from({ length: count }, (_, sampleIndex) => {
    const target = total * sampleIndex / (count - 1)
    let segment = 1
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1
    const segmentLength = cumulative[segment] - cumulative[segment - 1]
    const ratio = segmentLength === 0 ? 0 : (target - cumulative[segment - 1]) / segmentLength
    return {
      latitude: points[segment - 1].latitude + (points[segment].latitude - points[segment - 1].latitude) * ratio,
      longitude: normalizeLongitude(points[segment - 1].longitude + longitudeDelta(points[segment - 1].longitude, points[segment].longitude) * ratio),
    }
  })
}

function projected(point: GeoPoint, latitudeOrigin: number, longitudeOrigin: number) {
  return {
    x: EARTH_RADIUS_METERS * radians(longitudeDelta(longitudeOrigin, point.longitude)) * Math.cos(radians(latitudeOrigin)),
    y: EARTH_RADIUS_METERS * radians(point.latitude),
  }
}

export function pointToPolylineDistanceMeters(point: GeoPoint, polyline: GeoPoint[]) {
  if (!polyline.length) return Number.POSITIVE_INFINITY
  if (polyline.length === 1) return distanceMeters(point, polyline[0])
  let nearest = Number.POSITIVE_INFINITY
  for (let index = 1; index < polyline.length; index += 1) {
    const latitudeOrigin = (point.latitude + polyline[index - 1].latitude + polyline[index].latitude) / 3
    const longitudeOrigin = polyline[index - 1].longitude
    const target = projected(point, latitudeOrigin, longitudeOrigin)
    const start = projected(polyline[index - 1], latitudeOrigin, longitudeOrigin)
    const end = projected(polyline[index], latitudeOrigin, longitudeOrigin)
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((target.x - start.x) * dx + (target.y - start.y) * dy) / lengthSquared))
    nearest = Math.min(nearest, Math.hypot(target.x - (start.x + dx * ratio), target.y - (start.y + dy * ratio)))
  }
  return nearest
}

export function boundsForPoints(points: GeoPoint[]): GeoBounds | null {
  if (!points.length) return null
  const latitudes = points.map((point) => point.latitude)
  const longitudes = points.map((point) => normalizeLongitude(point.longitude)).sort((left, right) => left - right)
  let gapIndex = 0
  let largestGap = -1
  for (let index = 0; index < longitudes.length; index += 1) {
    const gap = (longitudes[(index + 1) % longitudes.length] + (index === longitudes.length - 1 ? 360 : 0)) - longitudes[index]
    if (gap > largestGap) { largestGap = gap; gapIndex = index }
  }
  return {
    north: Math.max(...latitudes),
    south: Math.min(...latitudes),
    east: longitudes[gapIndex],
    west: longitudes[(gapIndex + 1) % longitudes.length],
  }
}

export function expandBounds(bounds: GeoBounds, meters: number): GeoBounds {
  const latitudePadding = meters / 111_320
  const centerLatitude = (bounds.north + bounds.south) / 2
  const longitudePadding = meters / Math.max(1, 111_320 * Math.cos(radians(centerLatitude)))
  const span = ((bounds.east - bounds.west) + 360) % 360
  return {
    north: Math.min(90, bounds.north + latitudePadding),
    south: Math.max(-90, bounds.south - latitudePadding),
    east: span + longitudePadding * 2 >= 360 ? 180 : normalizeLongitude(bounds.east + longitudePadding),
    west: span + longitudePadding * 2 >= 360 ? -180 : normalizeLongitude(bounds.west - longitudePadding),
  }
}
