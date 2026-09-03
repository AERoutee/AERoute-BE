import type { RequestHandler } from 'express'
import { apiResponse } from '../../utils/index.js'
import type { InsightsService } from './insights.service.js'
import { createSavedCommuteSchema, createTripImpactSchema, resourceIdSchema, updateSavedCommuteSchema } from './insights.validation.js'

export class InsightsController {
  constructor(private readonly service: InsightsService) {}

  savedCommutes: RequestHandler = async (_request, response) => {
    response.status(200).json(apiResponse(await this.service.savedCommutes(response.locals.userId as string)))
  }

  createSavedCommute: RequestHandler = async (request, response) => {
    const commute = await this.service.createSavedCommute(response.locals.userId as string, createSavedCommuteSchema.parse(request.body))
    response.status(201).json(apiResponse(commute))
  }

  updateSavedCommute: RequestHandler = async (request, response) => {
    const commute = await this.service.updateSavedCommute(response.locals.userId as string, resourceIdSchema.parse(request.params.id), updateSavedCommuteSchema.parse(request.body))
    response.status(200).json(apiResponse(commute))
  }

  deleteSavedCommute: RequestHandler = async (request, response) => {
    const result = await this.service.deleteSavedCommute(response.locals.userId as string, resourceIdSchema.parse(request.params.id))
    response.status(200).json(apiResponse(result))
  }

  recordTripImpact: RequestHandler = async (request, response) => {
    const impact = await this.service.recordTripImpact(response.locals.userId as string, createTripImpactSchema.parse(request.body))
    response.status(201).json(apiResponse(impact))
  }

  tripImpactSummary: RequestHandler = async (_request, response) => {
    response.status(200).json(apiResponse(await this.service.tripImpactSummary(response.locals.userId as string)))
  }
}
