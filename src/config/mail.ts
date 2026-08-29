import nodemailer from 'nodemailer'
import { env } from './env.js'

if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) throw new Error('SMTP configuration is incomplete')

export const mailer = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  pool: true,
  maxConnections: 2,
  maxMessages: 50,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  connectionTimeout: 30_000,
  greetingTimeout: 15_000,
  socketTimeout: 30_000,
  tls: { minVersion: 'TLSv1.2', servername: env.SMTP_HOST },
})

function isTransient(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false
  return ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKET'].includes(String(error.code))
}

export async function sendEmail(to: string, subject: string, text: string) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mailer.sendMail({ from: env.SMTP_USER, to, subject, text })
      return
    } catch (error) {
      if (attempt === 1 || !isTransient(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 750))
    }
  }
}
