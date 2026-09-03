import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import type { RoadReportVerdict } from '../../generated/prisma/client.js'
import { AppError } from '../../middleware/index.js'
import { deleteRoadReportImage, getRoadReportImage, putRoadReportImage } from './providers/index.js'
import type { RoadReportRepository, StoredReportImage } from './road-report.repository.js'
import type { CreateRoadReportInput, NearbyRoadReportsInput } from './road-report.validation.js'

const REPORT_LIFETIME_MS = 24 * 60 * 60 * 1000
const REPORT_RATE_WINDOW_MS = 10 * 60 * 1000
const REPORT_RATE_MAX = 5

type Report = NonNullable<Awaited<ReturnType<RoadReportRepository['findById']>>>

function reportStatus(report: Report) {
  if (report.resolvedAt) return 'RESOLVED' as const
  if (report.expiresAt.getTime() <= Date.now()) return 'EXPIRED' as const
  return 'ACTIVE' as const
}

function reportEvidence(report: Report, viewerId: string | null) {
  const confirmations = report.verifications.filter((item) => item.verdict === 'CONFIRM').length
  const disputes = report.verifications.length - confirmations
  const ageRatio = Math.max(0, Math.min(1, 1 - (Date.now() - report.createdAt.getTime()) / REPORT_LIFETIME_MS))
  const netConfirmations = Math.max(0, confirmations - disputes)
  const factors = {
    recency: Math.round(ageRatio * 40),
    photos: Math.min(30, report.images.length * 10),
    voteBalance: Math.min(30, netConfirmations * 15),
  }
  const score = Math.max(0, Math.min(100, factors.recency + factors.photos + factors.voteBalance))
  return {
    verification: { confirmations, disputes, viewerVerdict: report.verifications.find((item) => item.userId === viewerId)?.verdict ?? null },
    evidence: { level: netConfirmations >= 2 && score >= 70 ? 'HIGH' as const : score >= 40 ? 'MEDIUM' as const : 'LOW' as const, score, kind: 'EVIDENCE_SCORE' as const, factors },
  }
}

function serializeReport(report: Report, viewerId: string | null) {
  const status = reportStatus(report)
  return {
    id: report.id,
    category: report.category,
    description: report.description,
    latitude: report.latitude,
    longitude: report.longitude,
    createdAt: report.createdAt.toISOString(),
    expiresAt: report.expiresAt.toISOString(),
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    status,
    images: status === 'ACTIVE' ? report.images.map((image) => `/api/v1/road-report-images/${image.id}`) : [],
    reporter: report.user?.name.split(/\s+/u)[0] ?? 'Community member',
    isOwner: Boolean(viewerId && report.userId === viewerId),
    ...reportEvidence(report, viewerId),
  }
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
      return serializeReport(report, userId)
    } catch (error) {
      await Promise.all(uploaded.map((image) => deleteRoadReportImage(image.objectKey)))
      throw error
    }
  }

  async image(rawId: unknown) {
    const id = z.string().uuid().safeParse(rawId)
    if (!id.success) throw new AppError(404, 'report_image_not_found', 'Report image was not found.', false)
    const image = await this.repository.findImage(id.data)
    if (!image || image.report.resolvedAt || image.report.expiresAt.getTime() <= Date.now()) throw new AppError(404, 'report_image_not_found', 'Report image was not found.', false)
    return getRoadReportImage(image.objectKey)
  }

  async nearby(bounds: NearbyRoadReportsInput, viewerId: string | null) {
    return (await this.repository.findNearby(bounds, new Date())).filter((report) => reportStatus(report) === 'ACTIVE').map((report) => serializeReport(report, viewerId))
  }

  async mine(userId: string) {
    return (await this.repository.findMine(userId)).map((report) => serializeReport(report, userId))
  }

  async verify(reportId: string, userId: string, verdict: RoadReportVerdict) {
    const report = await this.report(reportId)
    if (report.userId === userId) throw new AppError(400, 'report_self_verification', 'You cannot verify your own report.', false)
    const verified = await this.repository.verifyActive(reportId, userId, verdict, new Date())
    if (!verified) throw new AppError(409, 'report_inactive', 'Only active reports can be verified.', false)
    return reportEvidence(verified, userId)
  }

  async retractVerification(reportId: string, userId: string) {
    await this.report(reportId)
    await this.repository.deleteVerification(reportId, userId)
    return reportEvidence(await this.report(reportId), userId)
  }

  async resolve(reportId: string, userId: string) {
    const report = await this.report(reportId)
    if (report.userId !== userId) throw new AppError(404, 'road_report_not_found', 'Road report was not found.', false)
    if (report.resolvedAt) return serializeReport(report, userId)
    const resolved = await this.repository.resolveActive(reportId, userId, new Date())
    if (!resolved) throw new AppError(409, 'report_inactive', 'Only active reports can be resolved.', false)
    return serializeReport(resolved, userId)
  }

  private async report(id: string) {
    const report = await this.repository.findById(id)
    if (!report) throw new AppError(404, 'road_report_not_found', 'Road report was not found.', false)
    return report
  }
}
