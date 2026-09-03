import { Router } from 'express'
import { authMiddleware } from '../../middleware/index.js'
import { asyncHandler } from '../../utils/index.js'
import type { RouteComparisonController } from './route-comparison.controller.js'

export default function createRouteComparisonRoutes(controller: RouteComparisonController) {
  const router = Router()
  router.get('/place-photos', asyncHandler(authMiddleware), asyncHandler(controller.photo))
  router.post('/route-comparisons', asyncHandler(authMiddleware), asyncHandler(controller.compare))
  return router
}
