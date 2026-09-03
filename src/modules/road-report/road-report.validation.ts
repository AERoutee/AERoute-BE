import { z } from 'zod'

export const reportCategorySchema = z.enum(['HAZARD', 'BLOCKED_PATH', 'CRASH', 'CONSTRUCTION', 'MAP_ISSUE'])

export const createRoadReportSchema = z.object({
  category: reportCategorySchema,
  description: z.string().trim().min(10).max(500),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
})

export const reportVerdictSchema = z.object({ verdict: z.enum(['CONFIRM', 'DISPUTE']) })
export const resolveRoadReportSchema = z.object({ status: z.literal('RESOLVED') })
export const roadReportIdSchema = z.string().uuid()

export const nearbyRoadReportsSchema = z.object({
  north: z.coerce.number().min(-90).max(90),
  south: z.coerce.number().min(-90).max(90),
  east: z.coerce.number().min(-180).max(180),
  west: z.coerce.number().min(-180).max(180),
}).superRefine((value, context) => {
  const longitudeWidth = value.east >= value.west ? value.east - value.west : 360 - value.west + value.east
  if (value.north <= value.south) context.addIssue({ code: 'custom', path: ['north'], message: 'North must be greater than south.' })
  if (value.east === value.west) context.addIssue({ code: 'custom', path: ['east'], message: 'East and west must differ.' })
  if (value.north - value.south > 2 || longitudeWidth > 2) context.addIssue({ code: 'custom', path: ['request'], message: 'Map area is too large.' })
})

export type CreateRoadReportInput = z.infer<typeof createRoadReportSchema>
export type NearbyRoadReportsInput = z.infer<typeof nearbyRoadReportsSchema>
