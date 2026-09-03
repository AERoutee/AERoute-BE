import { fromNodeHeaders } from 'better-auth/node'
import type { RequestHandler } from 'express'
import { auth } from '../../config/index.js'
import { apiResponse } from '../../utils/index.js'
import type { RoadReportService } from './road-report.service.js'
import { createRoadReportSchema, nearbyRoadReportsSchema, reportVerdictSchema, resolveRoadReportSchema, roadReportIdSchema } from './road-report.validation.js'

export class RoadReportController {
  constructor(private readonly service: RoadReportService) {}

  create: RequestHandler = async (request, response) => {
    const input = createRoadReportSchema.parse(request.body)
    const report = await this.service.create(response.locals.userId as string, input, request.files as Express.Multer.File[] ?? [])
    response.status(201).json(apiResponse(report))
  }

  image: RequestHandler = async (request, response) => {
    const image = await this.service.image(request.params.id)
    response.set({ 'Content-Type': image.contentType, 'Content-Length': String(image.body.length), 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin', ...(image.etag ? { ETag: image.etag } : {}) }).status(200).send(image.body)
  }

  nearby: RequestHandler = async (request, response) => {
    const bounds = nearbyRoadReportsSchema.parse(request.query)
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) }).catch(() => null)
    const reports = await this.service.nearby(bounds, session?.user.id ?? null)
    response.status(200).json(apiResponse(reports))
  }

  mine: RequestHandler = async (_request, response) => {
    response.status(200).json(apiResponse(await this.service.mine(response.locals.userId as string)))
  }

  verify: RequestHandler = async (request, response) => {
    const id = roadReportIdSchema.parse(request.params.id)
    const { verdict } = reportVerdictSchema.parse(request.body)
    response.status(200).json(apiResponse(await this.service.verify(id, response.locals.userId as string, verdict)))
  }

  retractVerification: RequestHandler = async (request, response) => {
    const id = roadReportIdSchema.parse(request.params.id)
    response.status(200).json(apiResponse(await this.service.retractVerification(id, response.locals.userId as string)))
  }

  resolve: RequestHandler = async (request, response) => {
    const id = roadReportIdSchema.parse(request.params.id)
    resolveRoadReportSchema.parse(request.body)
    response.status(200).json(apiResponse(await this.service.resolve(id, response.locals.userId as string)))
  }
}
