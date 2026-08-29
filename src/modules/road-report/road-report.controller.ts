import type { RequestHandler } from 'express'
import { apiResponse } from '../../utils/index.js'
import type { RoadReportService } from './road-report.service.js'
import { createRoadReportSchema, nearbyRoadReportsSchema } from './road-report.validation.js'

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
    const reports = await this.service.nearby(bounds)
    response.status(200).json(apiResponse(reports))
  }
}
