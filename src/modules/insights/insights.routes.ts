import { Router } from 'express'
import { authMiddleware } from '../../middleware/index.js'
import { asyncHandler } from '../../utils/index.js'
import type { InsightsController } from './insights.controller.js'

export default function createInsightsRoutes(controller: InsightsController) {
  const router = Router()
  router.get('/saved-commutes', asyncHandler(authMiddleware), asyncHandler(controller.savedCommutes))
  router.post('/saved-commutes', asyncHandler(authMiddleware), asyncHandler(controller.createSavedCommute))
  router.patch('/saved-commutes/:id', asyncHandler(authMiddleware), asyncHandler(controller.updateSavedCommute))
  router.delete('/saved-commutes/:id', asyncHandler(authMiddleware), asyncHandler(controller.deleteSavedCommute))
  router.post('/trip-impacts', asyncHandler(authMiddleware), asyncHandler(controller.recordTripImpact))
  router.get('/trip-impacts/summary', asyncHandler(authMiddleware), asyncHandler(controller.tripImpactSummary))
  return router
}
