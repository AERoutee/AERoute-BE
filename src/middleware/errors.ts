import multer from 'multer'
import { ZodError } from 'zod'

export class AppError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string, public readonly retryable = false) {
    super(message)
  }
}

export const notFoundHandler: import('express').RequestHandler = (_request, _response, next) => {
  next(new AppError(404, 'not_found', 'Resource not found.'))
}

export const errorHandler: import('express').ErrorRequestHandler = (error: unknown, request, response, _next) => {
  if (error instanceof multer.MulterError) {
    response.locals.uploadErrorCode = error.code
    const isReport = request.path.includes('/road-reports')
    const isAvatar = request.path.includes('/profile/avatar')
    const isTooLarge = error.code === 'LIMIT_FILE_SIZE'
    const tooMany = error.code === 'LIMIT_FILE_COUNT'
    const code = isTooLarge ? (isReport ? 'report_image_too_large' : 'avatar_too_large') : tooMany ? (isReport ? 'report_image_limit' : 'avatar_file_limit') : isAvatar ? 'avatar_multipart_invalid' : 'upload_invalid'
    const message = isTooLarge ? (isReport ? 'Each report image must be 3 MB or smaller.' : 'Profile photo must be 5 MB or smaller.') : tooMany ? (isReport ? 'Attach no more than 3 images.' : 'Upload one profile photo at a time.') : isAvatar ? 'Profile photo request could not be read.' : 'Image upload is invalid.'
    response.status(isTooLarge ? 413 : 400).json({ error: { code, message, retryable: false } })
    return
  }
  if (error instanceof ZodError) {
    const fields = Object.fromEntries(error.issues.map((issue) => [issue.path.join('.') || 'request', issue.message]))
    response.status(400).json({ error: { code: 'validation_error', message: 'Check the submitted details.', retryable: false, fields } })
    return
  }
  const databaseCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (!(error instanceof AppError)) console.error('Request failed', { path: request.path, name: error instanceof Error ? error.name : 'UnknownError', code: databaseCode || undefined, message: error instanceof Error ? error.message : 'Unknown error' })
  const databaseError = databaseCode === 'P2022' ? new AppError(503, 'database_migration_required', 'The service database schema is out of date. Apply pending migrations.', false) : databaseCode === 'P1001' || databaseCode === 'P1002' || databaseCode === 'P1008' || databaseCode === 'P2021' ? new AppError(503, 'database_unavailable', 'The service database is not ready.', true) : null
  const appError = error instanceof AppError ? error : databaseError ?? new AppError(500, 'internal_error', 'An unexpected server error occurred.', true)
  response.status(appError.statusCode).json({ error: { code: appError.code, message: appError.message, retryable: appError.retryable } })
}
