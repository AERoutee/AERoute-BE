import type { CorsOptions } from 'cors'
import { env } from './env.js'

export const allowedOrigins = [...new Set([env.FRONTEND_ORIGIN.replace(/\/$/u, ''), ...env.CORS_ORIGINS])]

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) { callback(null, true); return }
    callback(null, allowedOrigins.includes(origin.replace(/\/$/u, '')))
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Length', 'ETag'],
  maxAge: 86_400,
  preflightContinue: false,
  optionsSuccessStatus: 204,
}
