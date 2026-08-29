import { z } from 'zod'
import { auth } from '../../config/auth.js'
import { AppError } from '../../middleware/index.js'
import { RecoveryRepository } from './recovery.repository.js'

const emailSchema = z.string().trim().toLowerCase().email().max(254)
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u)
const otpSchema = z.string().regex(/^\d{6}$/u)
const passwordSchema = z.string().min(8).max(128)

function maskEmail(email: string) {
  const [name, domain] = email.split('@')
  if (!name || !domain) return 'your email'
  return `${name.slice(0, 2)}${'*'.repeat(Math.max(2, name.length - 2))}@${domain}`
}

export class RecoveryService {
  constructor(private readonly repository: RecoveryRepository) {}

  async request(rawEmail: unknown, headers?: Headers) {
    const parsedEmail = emailSchema.safeParse(rawEmail)
    if (!parsedEmail.success) throw new AppError(400, 'email_invalid', 'Enter a valid email address.')
    const email = parsedEmail.data
    await this.repository.removeExpired()
    const id = await this.repository.create(email)
    await auth.api.requestPasswordResetEmailOTP({ body: { email }, headers })
    return { id, expiresInSeconds: 300 }
  }

  async resend(rawId: unknown, headers?: Headers) {
    const id = idSchema.safeParse(rawId)
    if (!id.success) throw new AppError(400, 'recovery_invalid', 'This recovery request is invalid or expired.')
    const challenge = await this.repository.find(id.data)
    if (!challenge) throw new AppError(400, 'recovery_invalid', 'This recovery request is invalid or expired.')
    const nextId = await this.repository.create(challenge.email)
    await auth.api.requestPasswordResetEmailOTP({ body: { email: challenge.email }, headers })
    await this.repository.consume(id.data)
    return { id: nextId, expiresInSeconds: 300 }
  }

  async read(rawId: unknown) {
    const id = idSchema.safeParse(rawId)
    if (!id.success) throw new AppError(404, 'recovery_not_found', 'This recovery request is invalid or expired.')
    const challenge = await this.repository.find(id.data)
    if (!challenge) throw new AppError(404, 'recovery_not_found', 'This recovery request is invalid or expired.')
    return { maskedEmail: maskEmail(challenge.email), expiresAt: challenge.expiresAt.toISOString() }
  }

  async verify(rawId: unknown, rawOtp: unknown) {
    const id = idSchema.safeParse(rawId)
    const otp = otpSchema.safeParse(rawOtp)
    if (!id.success || !otp.success) throw new AppError(400, 'recovery_invalid', 'The security code is invalid or expired.')
    const challenge = await this.repository.find(id.data)
    if (!challenge) throw new AppError(400, 'recovery_invalid', 'The security code is invalid or expired.')
    try {
      await auth.api.checkVerificationOTP({ body: { email: challenge.email, otp: otp.data, type: 'forget-password' } })
    } catch {
      throw new AppError(400, 'recovery_invalid', 'The security code is invalid, expired, or has been tried too many times.')
    }
    return { verified: true }
  }

  async reset(rawId: unknown, rawOtp: unknown, rawPassword: unknown) {
    const id = idSchema.safeParse(rawId)
    const otp = otpSchema.safeParse(rawOtp)
    const password = passwordSchema.safeParse(rawPassword)
    if (!id.success || !otp.success || !password.success) throw new AppError(400, 'recovery_invalid', 'The recovery request is invalid or expired.')
    const challenge = await this.repository.find(id.data)
    if (!challenge) throw new AppError(400, 'recovery_invalid', 'The recovery request is invalid or expired.')
    try {
      await auth.api.resetPasswordEmailOTP({ body: { email: challenge.email, otp: otp.data, password: password.data } })
    } catch {
      throw new AppError(400, 'recovery_invalid', 'The security code is invalid or expired.')
    }
    await this.repository.consume(id.data)
    return { success: true }
  }
}
