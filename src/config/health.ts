import type { RequestHandler } from 'express'
import { apiResponse } from '../utils/index.js'

export const healthHandler: RequestHandler = (_request, response) => {
  response.json(apiResponse({ status: 'ok', service: 'aeroute-api' }))
}
