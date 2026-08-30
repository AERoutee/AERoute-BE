import { prismaAdapter } from '@better-auth/prisma-adapter'
import { betterAuth } from 'better-auth'
import { emailOTP } from 'better-auth/plugins'
import { allowedOrigins } from './cors.js'
import { prisma } from './db.js'
import { env } from './env.js'
import { sendEmail } from './mail.js'

export const auth = betterAuth({
  appName: 'AERoute',
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: 'postgresql', transaction: true }),
  user: { modelName: 'msUser' },
  session: { modelName: 'trSession', expiresIn: 7 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  account: { modelName: 'msAccount', encryptOAuthTokens: true },
  verification: { modelName: 'trVerification', storeIdentifier: 'hashed' },
  trustedOrigins: allowedOrigins,
  advanced: { useSecureCookies: env.NODE_ENV === 'production', trustedProxyHeaders: env.TRUST_PROXY },
  rateLimit: {
    enabled: env.NODE_ENV !== 'test',
    window: 60,
    max: 100,
    storage: 'database',
    modelName: 'trRateLimit',
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
      '/email-otp/request-password-reset': { window: 60, max: 3 },
      '/email-otp/reset-password': { window: 60, max: 5 },
    },
  },
  socialProviders: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : undefined,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => { await sendEmail(user.email, 'Reset your AERoute password', `Open this link to create a new password: ${url}`) },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 5 * 60,
      allowedAttempts: 3,
      storeOTP: 'hashed',
      resendStrategy: 'rotate',
      rateLimit: { window: 60, max: 3 },
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== 'forget-password') return
        await sendEmail(email, 'Your AERoute security code', `Your AERoute security code is ${otp}. It expires in 5 minutes. If you did not request this code, you can ignore this email.`)
      },
    }),
  ],
})
