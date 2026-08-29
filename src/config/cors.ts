import type { CorsOptions } from 'cors'
import { env } from './env.js'

export const corsOptions: CorsOptions = {
  origin: env.FRONTEND_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['X-AERoute-Layer-Available'],
}
