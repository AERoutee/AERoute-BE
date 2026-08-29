import { Router } from 'express'
import multer from 'multer'
import { AppError, authMiddleware } from '../../middleware/index.js'
import { asyncHandler } from '../../utils/index.js'
import type { RoadReportController } from './road-report.controller.js'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 3, fields: 4, parts: 7 },
  fileFilter: (_request, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) { callback(new AppError(400, 'report_image_type_invalid', 'Choose JPG, PNG, or WebP images.', false)); return }
    callback(null, true)
  },
})

export default function createRoadReportRoutes(controller: RoadReportController) {
  const router = Router()
  router.get('/road-report-images/:id', asyncHandler(controller.image))
  router.get('/road-reports', asyncHandler(controller.nearby))
  router.post('/road-reports', asyncHandler(authMiddleware), upload.array('images', 3), asyncHandler(controller.create))
  return router
}
