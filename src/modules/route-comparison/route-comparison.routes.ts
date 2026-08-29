import { Router } from 'express'
import { asyncHandler } from '../../utils/index.js'
import type { RouteComparisonController } from './route-comparison.controller.js'

export default function createRouteComparisonRoutes(controller: RouteComparisonController) {
  const router = Router()
  router.post('/route-comparisons', asyncHandler(controller.compare))
  return router
}
