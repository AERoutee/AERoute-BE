import type { NextFunction, Request, Response } from 'express'

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
}

const SENSITIVE_KEYS = [
  'password',
  'token',
  'authorization',
  'cookie',
  'secret',
  'apikey',
  'otp',
  'file',
  'buffer',
]

function statusColor(status: number) {
  if (status < 300) return COLORS.green
  if (status < 400) return COLORS.yellow
  return COLORS.red
}

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (!value || typeof value !== 'object') return value
  if (Buffer.isBuffer(value)) return '[REDACTED]'
  if (seen.has(value)) return '[CIRCULAR]'

  seen.add(value)

  if (Array.isArray(value)) return value.map((item) => redact(item, seen))

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '')
      const isSensitive = SENSITIVE_KEYS.some((name) => normalizedKey.includes(name))
      return [key, isSensitive ? '[REDACTED]' : redact(item, seen)]
    }),
  )
}

function sanitizeUrl(originalUrl: string) {
  const [path] = originalUrl.split('?', 1)
  return path.replace(/(\/reset-password\/)[^/]+/u, '$1[REDACTED]').replace(/(\/recovery-challenges\/)[^/]+/u, '$1[REDACTED]')
}

function formatMultipart(request: Request, response: Response) {
  const files = request.file ? [request.file] : Array.isArray(request.files) ? request.files : request.files ? Object.values(request.files).flat() : []
  return JSON.stringify({ multipart: true, files: files.map((file) => ({ field: file.fieldname, mimeType: file.mimetype, size: file.size })), errorCode: response.locals.uploadErrorCode ?? undefined })
}

function formatBody(body: unknown): string {
  if (!body || typeof body !== 'object') return ''

  const serialized = JSON.stringify(redact(body))
  if (serialized === '{}' || serialized === '[]') return ''

  return serialized.length > 500 ? `${serialized.slice(0, 500)}...` : serialized
}

export function requestLogger(request: Request, response: Response, next: NextFunction) {
  const start = Date.now()
  const originalJson = response.json.bind(response)
  let responseBody: unknown

  response.json = ((body: unknown) => {
    responseBody = body
    return originalJson(body)
  }) as Response['json']

  response.on('finish', () => {
    if (request.path.includes('/map-layers/') && response.statusCode < 400) return
    const duration = Date.now() - start
    const method = request.method.padEnd(6)
    const status = response.statusCode
    const color = statusColor(status)
    const isMultipart = request.is('multipart/form-data')
    const requestBody = isMultipart ? formatMultipart(request, response) : formatBody(request.body)
    const responsePayload = formatBody(responseBody)
    const separator = `${COLORS.dim}${'='.repeat(72)}${COLORS.reset}`

    let line =
      `${separator}\n` +
      `${COLORS.dim}${new Date().toISOString()}${COLORS.reset} ` +
      `${COLORS.cyan}${method}${COLORS.reset} ${sanitizeUrl(request.originalUrl)} ` +
      `${color}${status}${COLORS.reset} ` +
      `${COLORS.magenta}${duration}ms${COLORS.reset}`

    if (request.ip) line += ` ${COLORS.dim}${request.ip}${COLORS.reset}`
    if (requestBody) line += `\n  ${COLORS.dim}-> req:${COLORS.reset} ${requestBody}`
    if (responsePayload) line += `\n  ${COLORS.dim}<- res:${COLORS.reset} ${responsePayload}`

    console.log(line)
  })

  next()
}
