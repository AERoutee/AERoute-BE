import { Router } from 'express'
import multer from 'multer'
import { AppError, authMiddleware } from '../../middleware/index.js'
import { asyncHandler } from '../../utils/index.js'
import type { ProfileController } from './profile.controller.js'

export const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, fieldSize: 1024, parts: 3 }, fileFilter: (_request, file, callback) => { if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) { callback(new AppError(400, 'avatar_type_invalid', 'Choose a JPG, PNG, or WebP image.', false)); return }; callback(null, true) } })

export default function createProfileRoutes(controller: ProfileController) {
  const router = Router()
  router.get('/profile/avatar/:userId', asyncHandler(controller.readAvatar))
  router.put('/profile/avatar', asyncHandler(authMiddleware), avatarUpload.single('avatar'), asyncHandler(controller.uploadAvatar))
  router.delete('/profile/avatar', asyncHandler(authMiddleware), asyncHandler(controller.removeAvatar))
  return router
}
