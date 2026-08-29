import { z } from 'zod'

const coordinateSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
})

export const routeComparisonRequestSchema = z.object({
  origin: coordinateSchema,
  destination: coordinateSchema,
  mode: z.enum(['WALK', 'BICYCLE']),
  preference: z.enum(['balanced', 'lower-exposure']),
  sensitiveUser: z.boolean().default(false),
}).refine((value) => value.origin.latitude !== value.destination.latitude || value.origin.longitude !== value.destination.longitude, { message: 'Origin and destination must be different.', path: ['destination'] })

export type RouteComparisonRequest = z.infer<typeof routeComparisonRequestSchema>
