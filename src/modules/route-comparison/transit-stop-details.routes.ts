import { Router } from 'express'
import { authMiddleware } from '../../middleware/index.js'
import { asyncHandler } from '../../utils/index.js'
import type { TransitStopDetailsController } from './transit-stop-details.controller.js'

export default function createTransitStopDetailsRoutes(controller: TransitStopDetailsController) {
  const router = Router()
  router.post('/transit-stop-details', asyncHandler(authMiddleware), asyncHandler(controller.details))
  return router
}
