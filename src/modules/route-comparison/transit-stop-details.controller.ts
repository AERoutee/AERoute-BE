import type { RequestHandler } from 'express'
import { z } from 'zod'
import { AppError } from '../../middleware/index.js'
import { apiResponse } from '../../utils/index.js'
import type { TransitStopDetailsService } from './transit-stop-details.service.js'

const requestSchema = z.object({
  name: z.string().trim().min(1).max(160).refine((value) => !/\p{Cc}/u.test(value), 'Name must not contain control characters.'),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  routeResultId: z.uuid().optional(),
  ordinal: z.number().int().min(0).max(99).optional(),
  role: z.enum(['departure', 'arrival']).optional(),
}).strict().refine((value) => [value.routeResultId, value.ordinal, value.role].filter((item) => item !== undefined).length === 0 || [value.routeResultId, value.ordinal, value.role].every((item) => item !== undefined), { message: 'Association context must include routeResultId, ordinal, and role.' })

const RATE_LIMIT_MAX = 30
const RATE_LIMIT_WINDOW_MS = 300_000
const RATE_LIMIT_USERS_MAX = 10_000

export class TransitStopDetailsController {
  private readonly rateLimits = new Map<string, { count: number; resetAt: number }>()

  constructor(private readonly service: TransitStopDetailsService) {}

  readonly details: RequestHandler = async (request, response) => {
    const input = requestSchema.parse(request.body)
    const userId = response.locals.userId as string
    const now = Date.now()
    const current = this.rateLimits.get(userId)
    if (current && now < current.resetAt && current.count >= RATE_LIMIT_MAX) throw new AppError(429, 'transit_stop_details_rate_limited', 'You can request up to 30 transit stop details every 5 minutes.', false)
    if (current && now < current.resetAt) current.count += 1
    else {
      if (this.rateLimits.size >= RATE_LIMIT_USERS_MAX) {
        for (const [key, value] of this.rateLimits) if (now >= value.resetAt) this.rateLimits.delete(key)
        if (this.rateLimits.size >= RATE_LIMIT_USERS_MAX) this.rateLimits.delete(this.rateLimits.keys().next().value!)
      }
      this.rateLimits.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    }
    response.set({ 'Cache-Control': 'private, no-store' }).status(200).json(apiResponse(await this.service.details(input, userId)))
  }
}
