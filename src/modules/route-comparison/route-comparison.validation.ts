import { z } from 'zod'

const coordinateSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
})

const departureOffsetsSchema = z.array(z.union([z.literal(0), z.literal(30), z.literal(60)])).min(1).max(3).refine((values) => new Set(values).size === values.length, 'Departure offsets must be unique.').default([0, 30, 60])
const accessPlanSchema = z.object({
  firstMileMode: z.literal('BICYCLE'),
  lastMileMode: z.literal('WALK'),
  bicyclePlan: z.literal('PARK_AT_FIRST_TRANSIT_STOP'),
}).strict()

export const routeComparisonRequestSchema = z.object({
  origin: coordinateSchema,
  destination: coordinateSchema,
  mode: z.enum(['WALK', 'BICYCLE', 'TRANSIT']),
  preference: z.enum(['balanced', 'lower-exposure']),
  sensitiveUser: z.boolean().default(false),
  transitModes: z.array(z.enum(['BUS', 'TRAIN', 'SUBWAY', 'LIGHT_RAIL', 'RAIL'])).min(1).max(5).refine((values) => new Set(values).size === values.length, 'Transit modes must be unique.').optional(),
  transitPreference: z.enum(['LESS_WALKING', 'FEWER_TRANSFERS']).optional(),
  accessibilityMode: z.enum(['STANDARD', 'REDUCED_EXERTION', 'STEP_FREE_REQUIRED']).default('STANDARD'),
  departureOffsetsMinutes: departureOffsetsSchema,
  hazardPolicy: z.enum(['ADVISORY_ONLY', 'PREFER_FEWER_REPORTS']).default('PREFER_FEWER_REPORTS'),
  includeRestStops: z.boolean().default(true),
  accessPlan: accessPlanSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.origin.latitude === value.destination.latitude && value.origin.longitude === value.destination.longitude) context.addIssue({ code: 'custom', message: 'Origin and destination must be different.', path: ['destination'] })
  if (value.mode !== 'TRANSIT' && value.transitModes !== undefined) context.addIssue({ code: 'custom', message: 'Transit modes are only valid for TRANSIT mode.', path: ['transitModes'] })
  if (value.mode !== 'TRANSIT' && value.transitPreference !== undefined) context.addIssue({ code: 'custom', message: 'Transit preference is only valid for TRANSIT mode.', path: ['transitPreference'] })
  if (value.accessPlan && value.mode !== 'TRANSIT') context.addIssue({ code: 'custom', message: 'Access plans are only valid for TRANSIT mode.', path: ['accessPlan'] })
  if (value.accessPlan && (value.departureOffsetsMinutes.length !== 1 || value.departureOffsetsMinutes[0] !== 0)) context.addIssue({ code: 'custom', message: 'Composite transit requires departureOffsetsMinutes exactly [0].', path: ['departureOffsetsMinutes'] })
  if (value.accessPlan && value.includeRestStops) context.addIssue({ code: 'custom', message: 'Composite transit does not support rest stops.', path: ['includeRestStops'] })
  if (value.accessPlan && value.accessibilityMode === 'STEP_FREE_REQUIRED') context.addIssue({ code: 'custom', message: 'Composite transit supports standard or reduced-exertion approximation only.', path: ['accessibilityMode'] })
}).transform((value) => value.mode === 'TRANSIT' && value.accessibilityMode === 'REDUCED_EXERTION' && value.transitPreference === undefined ? { ...value, transitPreference: 'LESS_WALKING' as const } : value)

export type RouteComparisonRequest = z.infer<typeof routeComparisonRequestSchema>
export type TravelMode = RouteComparisonRequest['mode']
export type TransitMode = NonNullable<RouteComparisonRequest['transitModes']>[number]
export type TransitPreference = NonNullable<RouteComparisonRequest['transitPreference']>
export type AccessibilityMode = RouteComparisonRequest['accessibilityMode']
export type HazardPolicy = RouteComparisonRequest['hazardPolicy']
