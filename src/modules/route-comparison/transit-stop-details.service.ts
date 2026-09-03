import { getPlaceDetails, getTransitStopDetails, type TransitStopDetailsInput } from './providers/google-places.provider.js'
import type { RouteComparisonRepository } from './route-comparison.repository.js'

export type TransitStopDetailsRequest = TransitStopDetailsInput & { routeResultId?: string; ordinal?: number; role?: 'departure' | 'arrival' }

export class TransitStopDetailsService {
  constructor(private readonly repository: RouteComparisonRepository) {}

  async details(input: TransitStopDetailsRequest, userId: string) {
    const { routeResultId, ordinal, role, ...search } = input
    if (routeResultId !== undefined && ordinal !== undefined && role !== undefined) {
      const association = await this.repository.findOwnedPlaceAssociation(userId, routeResultId, 'TRANSIT_STOP', ordinal, role)
      if (association) {
        let result = await getPlaceDetails(association.placeId)
        if (result.status === 'NOT_FOUND') {
          result = await getTransitStopDetails(search)
          if (result.status === 'NOT_FOUND') return result
          await this.repository.refreshPlaceAssociation(userId, association.id, result.place.id)
        } else if (result.place.id !== association.placeId || Date.now() - association.placeIdRefreshedAt.getTime() > 30 * 24 * 60 * 60 * 1000) {
          await this.repository.refreshPlaceAssociation(userId, association.id, result.place.id)
        }
        return { ...result, place: { ...result.place, associationId: association.id } }
      }
      const result = await getTransitStopDetails(search)
      if (result.status !== 'AVAILABLE') return result
      const [saved] = await this.repository.savePlaceAssociations(userId, routeResultId, 'TRANSIT_STOP', [{ placeId: result.place.id, ordinal, role }])
      return { ...result, place: { ...result.place, associationId: saved.id } }
    }
    return getTransitStopDetails(search)
  }
}
