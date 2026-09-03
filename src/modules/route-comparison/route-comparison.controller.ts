import type { RequestHandler } from 'express'
import { AppError } from '../../middleware/index.js'
import { apiResponse } from '../../utils/index.js'
import type { RouteComparisonService } from './route-comparison.service.js'
import { routeComparisonRequestSchema } from './route-comparison.validation.js'

const RATE_LIMIT_MAX = 10
const PHOTO_RATE_LIMIT_MAX = 60
const RATE_LIMIT_WINDOW_MS = 300_000
const RATE_LIMIT_USERS_MAX = 10_000

type RateLimits = Map<string, { count: number; resetAt: number }>

function checkRateLimit(rateLimits: RateLimits, userId: string, max: number, code: string, message: string) {
  const now = Date.now()
  const current = rateLimits.get(userId)
  if (current && now < current.resetAt && current.count >= max) throw new AppError(429, code, message, false)
  if (current && now < current.resetAt) {
    current.count += 1
    return
  }
  if (rateLimits.size >= RATE_LIMIT_USERS_MAX) {
    for (const [key, value] of rateLimits) if (now >= value.resetAt) rateLimits.delete(key)
    if (rateLimits.size >= RATE_LIMIT_USERS_MAX) rateLimits.delete(rateLimits.keys().next().value!)
  }
  rateLimits.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
}

export class RouteComparisonController {
  private readonly rateLimits: RateLimits = new Map()
  private readonly photoRateLimits: RateLimits = new Map()

  constructor(private readonly service: RouteComparisonService) {}

  readonly photo: RequestHandler = async (request, response) => {
    checkRateLimit(this.photoRateLimits, response.locals.userId as string, PHOTO_RATE_LIMIT_MAX, 'place_photo_rate_limited', 'You can request up to 60 place photos every 5 minutes.')
    const result = await this.service.photo(String(request.query.name ?? ''))
    response.set({ 'Content-Type': result.contentType, 'Content-Length': String(result.body.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' }).status(200).send(result.body)
  }

  readonly compare: RequestHandler = async (request, response) => {
    const input = routeComparisonRequestSchema.parse(request.body)
    const userId = response.locals.userId as string
    const now = Date.now()
    const current = this.rateLimits.get(userId)
    if (current && now < current.resetAt && current.count >= RATE_LIMIT_MAX) throw new AppError(429, 'route_comparison_rate_limited', 'You can compare up to 10 routes every 5 minutes.', false)
    if (!current || now >= current.resetAt) {
      if (this.rateLimits.size >= RATE_LIMIT_USERS_MAX) {
        for (const [key, value] of this.rateLimits) if (now >= value.resetAt) this.rateLimits.delete(key)
        if (this.rateLimits.size >= RATE_LIMIT_USERS_MAX) this.rateLimits.delete(this.rateLimits.keys().next().value!)
      }
      this.rateLimits.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    } else current.count += 1
    const result = await this.service.compare(input, userId)
    response.status(200).json(apiResponse(result, { routeCount: result.routes.length }))
  }
}
