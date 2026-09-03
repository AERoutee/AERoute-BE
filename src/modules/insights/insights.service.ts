import { Prisma } from '../../generated/prisma/client.js'
import { AppError } from '../../middleware/index.js'
import type { InsightsRepository } from './insights.repository.js'
import type { CreateSavedCommuteInput, CreateTripImpactInput, UpdateSavedCommuteInput } from './insights.validation.js'

const TRIP_DAILY_MAX = 50
const DISCLAIMER = 'Modeled exposure indices are comparative estimates, not medical measurements or actual inhaled dose.'

type SavedCommute = Awaited<ReturnType<InsightsRepository['createSavedCommute']>>
type TripImpact = NonNullable<Awaited<ReturnType<InsightsRepository['createTripImpact']>>>

function preference(value: CreateSavedCommuteInput['preference']) {
  return value === 'lower-exposure' ? 'lower_exposure' as const : 'balanced' as const
}

function serializeCommute(commute: SavedCommute) {
  return {
    id: commute.id,
    name: commute.name,
    origin: { label: commute.originLabel, latitude: commute.originLatitude, longitude: commute.originLongitude },
    destination: { label: commute.destinationLabel, latitude: commute.destinationLatitude, longitude: commute.destinationLongitude },
    mode: commute.mode,
    preference: commute.preference === 'lower_exposure' ? 'lower-exposure' : 'balanced',
    transitModes: commute.transitModes,
    transitPreference: commute.transitPreference,
    accessibilityMode: commute.accessibilityMode,
    sensitiveUser: commute.sensitiveUser,
    watchEnabled: commute.watchEnabled,
    watchHour: commute.watchHour,
    createdAt: commute.createdAt.toISOString(),
    updatedAt: commute.updatedAt.toISOString(),
  }
}

function createCommuteData(input: CreateSavedCommuteInput) {
  return {
    name: input.name,
    originLabel: input.origin.label,
    originLatitude: input.origin.latitude,
    originLongitude: input.origin.longitude,
    destinationLabel: input.destination.label,
    destinationLatitude: input.destination.latitude,
    destinationLongitude: input.destination.longitude,
    mode: input.mode,
    preference: preference(input.preference),
    transitModes: input.transitModes,
    transitPreference: input.transitPreference,
    accessibilityMode: input.accessibilityMode,
    sensitiveUser: input.sensitiveUser,
    watchEnabled: input.watchEnabled,
    watchHour: input.watchHour,
  }
}

function updateCommuteData(input: UpdateSavedCommuteInput) {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.origin !== undefined ? { originLabel: input.origin.label, originLatitude: input.origin.latitude, originLongitude: input.origin.longitude } : {}),
    ...(input.destination !== undefined ? { destinationLabel: input.destination.label, destinationLatitude: input.destination.latitude, destinationLongitude: input.destination.longitude } : {}),
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.preference !== undefined ? { preference: preference(input.preference) } : {}),
    ...(input.transitModes !== undefined ? { transitModes: input.transitModes } : {}),
    ...(input.transitPreference !== undefined ? { transitPreference: input.transitPreference } : {}),
    ...(input.accessibilityMode !== undefined ? { accessibilityMode: input.accessibilityMode } : {}),
    ...(input.sensitiveUser !== undefined ? { sensitiveUser: input.sensitiveUser } : {}),
    ...(input.watchEnabled !== undefined ? { watchEnabled: input.watchEnabled } : {}),
    ...(input.watchHour !== undefined ? { watchHour: input.watchHour } : {}),
  }
}

function serializeTripImpact(impact: TripImpact) {
  return {
    id: impact.id,
    comparisonId: impact.routeResult.comparisonId,
    routeResultId: impact.routeResultId,
    mode: impact.mode,
    distanceMeters: impact.distanceMeters,
    durationSeconds: impact.durationSeconds,
    activeDistanceMeters: impact.activeDistanceMeters,
    activeDurationSeconds: impact.activeDurationSeconds,
    baselineExposureIndex: impact.baselineExposureIndex,
    selectedExposureIndex: impact.selectedExposureIndex,
    fewerConfirmedReportSignals: impact.fewerConfirmedReportSignals,
    completedAt: impact.completedAt.toISOString(),
  }
}

export class InsightsService {
  constructor(private readonly repository: InsightsRepository) {}

  async savedCommutes(userId: string) {
    return (await this.repository.listSavedCommutes(userId)).map(serializeCommute)
  }

  async createSavedCommute(userId: string, input: CreateSavedCommuteInput) {
    return serializeCommute(await this.repository.createSavedCommute(userId, createCommuteData(input)))
  }

  async updateSavedCommute(userId: string, id: string, input: UpdateSavedCommuteInput) {
    const current = await this.repository.findSavedCommute(userId, id)
    if (!current) throw new AppError(404, 'saved_commute_not_found', 'Saved commute was not found.', false)
    const mode = input.mode ?? current.mode
    if (mode !== 'TRANSIT' && (input.transitModes?.length || input.transitPreference != null)) throw new AppError(400, 'saved_commute_transit_options_invalid', 'Transit options require TRANSIT mode.', false)
    const data = { ...updateCommuteData(input), ...(input.mode !== undefined && input.mode !== 'TRANSIT' ? { transitModes: [], transitPreference: null } : {}) }
    return serializeCommute(await this.repository.updateSavedCommute(id, data))
  }

  async deleteSavedCommute(userId: string, id: string) {
    if (!await this.repository.findSavedCommute(userId, id)) throw new AppError(404, 'saved_commute_not_found', 'Saved commute was not found.', false)
    await this.repository.deleteSavedCommute(id)
    return { deleted: true }
  }

  async recordTripImpact(userId: string, input: CreateTripImpactInput) {
    const source = await this.repository.findTripImpactSource(userId, input.routeResultId)
    const selected = source?.routes.find((route) => route.id === input.routeResultId)
    if (!source || !selected) throw new AppError(404, 'trip_impact_source_not_found', 'Route comparison result was not found.', false)
    const now = new Date()
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const fastest = source.routes.filter((route) => route.labels.includes('FASTEST')).sort((left, right) => left.durationSeconds - right.durationSeconds)[0]
    const baselineExposureIndex = fastest?.estimatedExposureIndex ?? Math.max(...source.routes.map((route) => route.estimatedExposureIndex))
    try {
      const impact = await this.repository.createTripImpact(userId, dayStart, TRIP_DAILY_MAX, {
        routeResultId: input.routeResultId,
        mode: source.mode,
        distanceMeters: selected.distanceMeters,
        durationSeconds: selected.durationSeconds,
        activeDistanceMeters: selected.activeDistanceMeters,
        activeDurationSeconds: selected.activeDurationSeconds,
        baselineExposureIndex,
        selectedExposureIndex: selected.estimatedExposureIndex,
        fewerConfirmedReportSignals: selected.fewerConfirmedReportSignals,
      })
      if (!impact) throw new AppError(429, 'trip_impact_rate_limited', 'You can record up to 50 completed trips per day.', false)
      return serializeTripImpact(impact)
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError(409, 'trip_impact_already_recorded', 'This completed route result was already recorded.', false)
      throw error
    }
  }

  async tripImpactSummary(userId: string) {
    const impacts = await this.repository.listTripImpacts(userId)
    const totals = impacts.reduce((sum, impact) => ({
      distance: sum.distance + impact.activeDistanceMeters,
      duration: sum.duration + impact.activeDurationSeconds,
      baseline: sum.baseline + impact.baselineExposureIndex,
      selected: sum.selected + impact.selectedExposureIndex,
      reportSignals: sum.reportSignals + impact.fewerConfirmedReportSignals,
    }), { distance: 0, duration: 0, baseline: 0, selected: 0, reportSignals: 0 })
    return {
      completedTrips: impacts.length,
      activeTravelDistanceMeters: totals.distance,
      activeTravelDurationSeconds: totals.duration,
      modeledExposureIndexBaseline: totals.baseline,
      modeledExposureIndexSelected: totals.selected,
      modeledExposureIndexReduction: Math.max(0, totals.baseline - totals.selected),
      fewerConfirmedReportSignals: totals.reportSignals,
      disclaimer: DISCLAIMER,
    }
  }
}
