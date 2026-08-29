import { Router } from 'express'
import { asyncHandler } from '../../utils/index.js'
import type { RecoveryController } from './recovery.controller.js'

export default function createRecoveryRoutes(controller: RecoveryController) {
  const router = Router()
  router.post('/recovery-challenges', asyncHandler(controller.request))
  router.get('/recovery-challenges/:id', asyncHandler(controller.read))
  router.post('/recovery-challenges/:id/resend', asyncHandler(controller.resend))
  router.post('/recovery-challenges/:id/verify', asyncHandler(controller.verify))
  router.post('/recovery-challenges/:id/reset', asyncHandler(controller.reset))
  return router
}
