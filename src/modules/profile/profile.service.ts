import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { AppError } from '../../middleware/index.js'
import { deleteAvatar, getAvatar, putAvatar } from './providers/avatar-storage.provider.js'
import type { ProfileRepository } from './profile.repository.js'

export class ProfileService {
  constructor(private readonly repository: ProfileRepository) {}

  async uploadAvatar(userId: string, file?: Express.Multer.File) {
    if (!file) throw new AppError(400, 'avatar_required', 'Choose a profile photo.', false)
    const metadata = await sharp(file.buffer, { failOn: 'warning', limitInputPixels: 25_000_000, animated: false }).metadata().catch(() => { throw new AppError(400, 'avatar_invalid', 'Choose a valid JPG, PNG, or WebP image.', false) })
    if (!metadata.width || !metadata.height || metadata.width < 64 || metadata.height < 64) throw new AppError(400, 'avatar_too_small', 'Profile photo must be at least 64 by 64 pixels.', false)
    const body = await sharp(file.buffer, { failOn: 'warning', limitInputPixels: 25_000_000, animated: false }).autoOrient().resize(512, 512, { fit: 'cover', position: 'centre', withoutEnlargement: false }).webp({ quality: 82, effort: 4 }).toBuffer()
    const version = randomUUID()
    const key = `avatars/${userId}/${version}.webp`
    const current = await this.repository.findAvatar(userId)
    const stored = await putAvatar(key, body)
    const image = stored.isPublic ? stored.url : `/api/v1/profile/avatar/${encodeURIComponent(userId)}?v=${version}`
    try {
      await this.repository.updateAvatar(userId, key, image)
    } catch {
      await deleteAvatar(key).catch(() => undefined)
      throw new AppError(500, 'avatar_profile_update_failed', 'Profile photo could not be saved.', true)
    }
    if (current?.avatarKey) void deleteAvatar(current.avatarKey).catch(() => undefined)
    return { image }
  }

  async removeAvatar(userId: string) {
    const current = await this.repository.findAvatar(userId)
    await this.repository.removeAvatar(userId)
    if (current?.avatarKey) void deleteAvatar(current.avatarKey).catch(() => undefined)
    return { image: null }
  }

  async readAvatar(userId: string) {
    const current = await this.repository.findAvatar(userId)
    if (!current?.avatarKey) throw new AppError(404, 'avatar_not_found', 'Profile photo was not found.', false)
    return getAvatar(current.avatarKey)
  }
}
