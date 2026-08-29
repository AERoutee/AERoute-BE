import { fromNodeHeaders } from 'better-auth/node'
import type { RequestHandler } from 'express'
import { auth } from '../../config/index.js'
import { apiResponse } from '../../utils/index.js'
import type { RouteComparisonService } from './route-comparison.service.js'
import { routeComparisonRequestSchema } from './route-comparison.validation.js'

export class RouteComparisonController {
  constructor(private readonly service: RouteComparisonService) {}

  readonly compare: RequestHandler = async (request, response) => {
    const input = routeComparisonRequestSchema.parse(request.body)
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    const result = await this.service.compare(input, session?.user.id ?? null)
    response.status(200).json(apiResponse(result, { routeCount: result.routes.length }))
  }
}
