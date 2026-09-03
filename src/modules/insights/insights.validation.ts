import { z } from 'zod'

const coordinateSchema = z.object({
  label: z.string().trim().min(1).max(180),
  latitude: z.coerce.number().finite().min(-90).max(90),
  longitude: z.coerce.number().finite().min(-180).max(180),
})

const commuteFields = {
  name: z.string().trim().min(1).max(80),
  origin: coordinateSchema,
  destination: coordinateSchema,
  mode: z.enum(['WALK', 'BICYCLE', 'TRANSIT']),
  preference: z.enum(['balanced', 'lower-exposure']),
  transitModes: z.array(z.enum(['BUS', 'TRAIN', 'SUBWAY', 'LIGHT_RAIL', 'RAIL'])).max(5).refine((values) => new Set(values).size === values.length, 'Transit modes must be unique.'),
  transitPreference: z.enum(['LESS_WALKING', 'FEWER_TRANSFERS']).nullable(),
  accessibilityMode: z.enum(['STANDARD', 'REDUCED_EXERTION']),
  sensitiveUser: z.boolean(),
  watchEnabled: z.boolean(),
  watchHour: z.union([z.null(), z.coerce.number().int().min(0).max(23)]),
}

function commuteCompatibility(value: { mode?: string; transitModes?: unknown[]; transitPreference?: unknown }, context: z.RefinementCtx) {
  if (value.mode !== undefined && value.mode !== 'TRANSIT' && value.transitModes?.length) context.addIssue({ code: 'custom', message: 'Transit modes are only valid for TRANSIT mode.', path: ['transitModes'] })
  if (value.mode !== undefined && value.mode !== 'TRANSIT' && value.transitPreference != null) context.addIssue({ code: 'custom', message: 'Transit preference is only valid for TRANSIT mode.', path: ['transitPreference'] })
}

export const createSavedCommuteSchema = z.object({ ...commuteFields, transitModes: commuteFields.transitModes.default([]), transitPreference: commuteFields.transitPreference.default(null), accessibilityMode: commuteFields.accessibilityMode.default('STANDARD'), sensitiveUser: commuteFields.sensitiveUser.default(false), watchEnabled: commuteFields.watchEnabled.default(true), watchHour: commuteFields.watchHour.default(null) }).superRefine(commuteCompatibility)
export const updateSavedCommuteSchema = z.object(Object.fromEntries(Object.entries(commuteFields).map(([key, schema]) => [key, schema.optional()])) as { [Key in keyof typeof commuteFields]: z.ZodOptional<(typeof commuteFields)[Key]> }).refine((value) => Object.keys(value).length > 0, { message: 'Provide at least one field.' }).superRefine(commuteCompatibility)

export const createTripImpactSchema = z.object({
  routeResultId: z.string().uuid(),
}).strict()

export const resourceIdSchema = z.string().uuid()

export type CreateSavedCommuteInput = z.infer<typeof createSavedCommuteSchema>
export type UpdateSavedCommuteInput = z.infer<typeof updateSavedCommuteSchema>
export type CreateTripImpactInput = z.infer<typeof createTripImpactSchema>
