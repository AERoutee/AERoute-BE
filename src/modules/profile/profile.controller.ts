import type { RequestHandler } from 'express'
import { apiResponse } from '../../utils/index.js'
import type { ProfileService } from './profile.service.js'

export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  readonly uploadAvatar: RequestHandler = async (request, response) => {
    const result = await this.service.uploadAvatar(response.locals.userId as string, request.file)
    response.status(200).json(apiResponse(result))
  }

  readonly removeAvatar: RequestHandler = async (_request, response) => {
    const result = await this.service.removeAvatar(response.locals.userId as string)
    response.status(200).json(apiResponse(result))
  }

  readonly readAvatar: RequestHandler = async (request, response) => {
    const body = await this.service.readAvatar(String(request.params.userId))
    response.set({ 'Content-Type': 'image/webp', 'Content-Length': String(body.length), 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' }).status(200).send(body)
  }
}
