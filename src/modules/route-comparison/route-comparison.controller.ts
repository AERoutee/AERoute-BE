import { fromNodeHeaders } from 'better-auth/node'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { auth, env } from '../../config/index.js'
import { AppError } from '../../middleware/index.js'
import { apiResponse } from '../../utils/index.js'
import type { RouteComparisonService } from './route-comparison.service.js'
import { routeComparisonRequestSchema } from './route-comparison.validation.js'
import { normalizeTileCoordinates } from './tile-coordinates.js'

const heatmapTileSchema = z.object({ zoom: z.coerce.number().int().min(0).max(16), x: z.coerce.number().int(), y: z.coerce.number().int() })
const googleErrorSchema = z.object({ error: z.object({ details: z.array(z.object({ reason: z.string().optional() }).passthrough()).optional() }) })
const transparentTile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
const heatmapTileCache = new Map<string, { body: Buffer; expiresAt: number }>()
const heatmapInFlight = new Map<string, Promise<Buffer>>()
const heatmapQueue: Array<() => void> = []
let activeHeatmapRequests = 0
let heatmapCircuitOpenUntil = 0

async function withHeatmapSlot<T>(task: () => Promise<T>) {
  if (activeHeatmapRequests >= 3) await new Promise<void>((resolve) => heatmapQueue.push(resolve))
  activeHeatmapRequests += 1
  try {
    if (heatmapCircuitOpenUntil > Date.now()) throw new AppError(503, 'air_quality_tile_quota', 'Air-quality map quota is temporarily unavailable.', false)
    return await task()
  } finally {
    activeHeatmapRequests -= 1
    heatmapQueue.shift()?.()
  }
}

async function loadHeatmapTile(apiKey: string, zoom: number, x: number, y: number) {
  return withHeatmapSlot(async () => {
    const url = `https://airquality.googleapis.com/v1/mapTypes/UAQI_RED_GREEN/heatmapTiles/${zoom}/${x}/${y}?key=${encodeURIComponent(apiKey)}`
    const providerResponse = await fetch(url, { signal: AbortSignal.timeout(env.PROVIDER_TIMEOUT_MS) }).catch(() => { throw new AppError(503, 'air_quality_tile_unavailable', 'Air-quality map is unavailable.', true) })
    if (!providerResponse.ok) {
      const payload = await providerResponse.json().catch(() => null)
      const parsed = googleErrorSchema.safeParse(payload)
      const reason = parsed.success ? parsed.data.error.details?.find((detail) => detail.reason)?.reason : undefined
      if (providerResponse.status === 429 || reason === 'RATE_LIMIT_EXCEEDED') { heatmapCircuitOpenUntil = Date.now() + 5 * 60 * 1000; throw new AppError(503, 'air_quality_tile_quota', 'Air-quality map quota is temporarily unavailable.', false) }
      if (reason === 'BILLING_DISABLED' || reason === 'API_KEY_SERVICE_BLOCKED' || reason === 'SERVICE_DISABLED' || reason === 'API_KEY_INVALID') { heatmapCircuitOpenUntil = Date.now() + 15 * 60 * 1000; throw new AppError(503, 'air_quality_tile_configuration', 'Air-quality map is not available.', false) }
      throw new AppError(providerResponse.status >= 500 ? 503 : 502, 'air_quality_tile_error', 'Air-quality map is unavailable.', providerResponse.status >= 500)
    }
    return Buffer.from(await providerResponse.arrayBuffer())
  })
}

export class RouteComparisonController {
  constructor(private readonly service: RouteComparisonService) {}

  readonly compare: RequestHandler = async (request, response) => {
    const input = routeComparisonRequestSchema.parse(request.body)
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
    const result = await this.service.compare(input, session?.user.id ?? null)
    response.status(200).json(apiResponse(result, { routeCount: result.routes.length }))
  }

  readonly airQualityTile: RequestHandler = async (request, response) => {
    const { zoom, x, y } = heatmapTileSchema.parse(request.params)
    const { x: normalizedX, isValidY } = normalizeTileCoordinates(zoom, x, y)
    if (!isValidY) { response.set({ 'Content-Type': 'image/png', 'Content-Length': String(transparentTile.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-AERoute-Layer-Available': 'false' }).status(200).send(transparentTile); return }
    const apiKey = env.GOOGLE_MAPS_SERVER_KEY
    if (!apiKey) throw new AppError(503, 'air_quality_not_configured', 'Air-quality map is not configured.', false)
    const cacheKey = `${zoom}/${normalizedX}/${y}`
    const cached = heatmapTileCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) { response.set({ 'Content-Type': 'image/png', 'Content-Length': String(cached.body.length), 'Cache-Control': 'public, max-age=600', 'X-Content-Type-Options': 'nosniff', 'X-AERoute-Layer-Available': 'true' }).status(200).send(cached.body); return }
    if (heatmapCircuitOpenUntil > Date.now()) { response.set({ 'Content-Type': 'image/png', 'Content-Length': String(transparentTile.length), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-AERoute-Layer-Available': 'false' }).status(200).send(transparentTile); return }
    let pending = heatmapInFlight.get(cacheKey)
    if (!pending) {
      pending = loadHeatmapTile(apiKey, zoom, normalizedX, y)
      heatmapInFlight.set(cacheKey, pending)
      void pending.finally(() => heatmapInFlight.delete(cacheKey)).catch(() => undefined)
    }
    const body = await pending
    if (heatmapTileCache.size >= 500) heatmapTileCache.delete(heatmapTileCache.keys().next().value ?? '')
    heatmapTileCache.set(cacheKey, { body, expiresAt: Date.now() + 10 * 60 * 1000 })
    response.set({ 'Content-Type': 'image/png', 'Content-Length': String(body.length), 'Cache-Control': 'public, max-age=600', 'X-Content-Type-Options': 'nosniff', 'X-AERoute-Layer-Available': 'true' }).status(200).send(body)
  }
}
