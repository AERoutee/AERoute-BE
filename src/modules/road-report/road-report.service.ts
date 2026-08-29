import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import { AppError } from '../../middleware/index.js'
import { deleteRoadReportImage, getRoadReportImage, putRoadReportImage } from './providers/index.js'
import type { RoadReportRepository, StoredReportImage } from './road-report.repository.js'
import type { CreateRoadReportInput, NearbyRoadReportsInput } from './road-report.validation.js'

const REPORT_LIFETIME_MS = 24 * 60 * 60 * 1000
const REPORT_RATE_WINDOW_MS = 10 * 60 * 1000
const REPORT_RATE_MAX = 5

function serializeReport(report: Awaited<ReturnType<RoadReportRepository['create']>>) {
  return { id: report.id, category: report.category, description: report.description, latitude: report.latitude, longitude: report.longitude, createdAt: report.createdAt.toISOString(), expiresAt: report.expiresAt.toISOString(), images: report.images.map((image) => `/api/v1/road-report-images/${image.id}`), reporter: report.user?.name.split(/\s+/u)[0] ?? 'Community member' }
}

export class RoadReportService {
  constructor(private readonly repository: RoadReportRepository) {}

  async create(userId: string, input: CreateRoadReportInput, files: Express.Multer.File[]) {
    if (files.length > 3) throw new AppError(400, 'report_image_limit', 'Attach no more than 3 images.', false)
    const recentCount = await this.repository.countRecentByUser(userId, new Date(Date.now() - REPORT_RATE_WINDOW_MS))
    if (recentCount >= REPORT_RATE_MAX) throw new AppError(429, 'report_rate_limited', 'You can submit up to 5 reports every 10 minutes.', false)

    const reportId = randomUUID()
    const uploaded: StoredReportImage[] = []
    try {
      for (const [position, file] of files.entries()) {
        const metadata = await sharp(file.buffer, { failOn: 'warning', limitInputPixels: 20_000_000, animated: false }).metadata().catch(() => { throw new AppError(400, 'report_image_invalid', 'Choose valid JPG, PNG, or WebP images.', false) })
        if (!metadata.width || !metadata.height || metadata.width < 64 || metadata.height < 64) throw new AppError(400, 'report_image_too_small', 'Report images must be at least 64 by 64 pixels.', false)
        const output = await sharp(file.buffer, { failOn: 'warning', limitInputPixels: 20_000_000, animated: false }).autoOrient().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80, effort: 4 }).toBuffer({ resolveWithObject: true })
        const objectKey = `road-reports/${reportId}/${randomUUID()}.webp`
        const imageUrl = await putRoadReportImage(objectKey, output.data)
        uploaded.push({ objectKey, imageUrl, position, width: output.info.width, height: output.info.height })
      }
      const report = await this.repository.create({ id: reportId, userId, category: input.category, description: input.description, latitude: input.latitude, longitude: input.longitude, expiresAt: new Date(Date.now() + REPORT_LIFETIME_MS), images: uploaded })
      return serializeReport(report)
    } catch (error) {
      await Promise.all(uploaded.map((image) => deleteRoadReportImage(image.objectKey)))
      throw error
    }
  }

  async image(rawId: unknown) {
    const id = z.string().uuid().safeParse(rawId)
    if (!id.success) throw new AppError(404, 'report_image_not_found', 'Report image was not found.', false)
    const image = await this.repository.findImage(id.data)
    if (!image) throw new AppError(404, 'report_image_not_found', 'Report image was not found.', false)
    return getRoadReportImage(image.objectKey)
  }

  async nearby(bounds: NearbyRoadReportsInput) {
    const reports = await this.repository.findNearby(bounds)
    return reports.map(serializeReport)
  }
}
