import { fromNodeHeaders } from 'better-auth/node'
import type { RequestHandler } from 'express'
import { apiResponse } from '../../utils/index.js'
import type { RecoveryService } from './recovery.service.js'

export class RecoveryController {
  constructor(private readonly service: RecoveryService) {}

  request: RequestHandler = async (request, response) => {
    const result = await this.service.request(request.body?.email, fromNodeHeaders(request.headers))
    response.status(200).json(apiResponse(result))
  }

  resend: RequestHandler = async (request, response) => {
    const result = await this.service.resend(request.params.id, fromNodeHeaders(request.headers))
    response.status(200).json(apiResponse(result))
  }

  read: RequestHandler = async (request, response) => {
    const result = await this.service.read(request.params.id)
    response.status(200).json(apiResponse(result))
  }

  verify: RequestHandler = async (request, response) => {
    const result = await this.service.verify(request.params.id, request.body?.otp)
    response.status(200).json(apiResponse(result))
  }

  reset: RequestHandler = async (request, response) => {
    const result = await this.service.reset(request.params.id, request.body?.otp, request.body?.password)
    response.status(200).json(apiResponse(result))
  }
}
