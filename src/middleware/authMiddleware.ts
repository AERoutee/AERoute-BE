import { fromNodeHeaders } from 'better-auth/node'
import type { RequestHandler } from 'express'
import { auth } from '../config/index.js'
import { AppError } from './errors.js'

export const authMiddleware: RequestHandler = async (request, response, next) => {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) })
  if (!session?.user.id) { next(new AppError(401, 'authentication_required', 'Sign in to continue.', false)); return }
  response.locals.userId = session.user.id
  next()
}
