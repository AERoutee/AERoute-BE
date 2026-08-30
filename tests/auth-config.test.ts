type AuthOptions = Record<string, any>

const baseEnvironment = {
  BETTER_AUTH_URL: 'https://api.example.com',
  BETTER_AUTH_SECRET: 's'.repeat(32),
  NODE_ENV: 'production',
  TRUST_PROXY: true,
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
}

function loadAuth(overrides: Partial<typeof baseEnvironment> = {}) {
  jest.resetModules()
  const betterAuth = jest.fn((options: AuthOptions) => ({ options }))
  const emailOTP = jest.fn((options: AuthOptions) => ({ id: 'email-otp', options }))
  const prismaAdapter = jest.fn(() => ({ adapter: 'prisma' }))
  const sendEmail = jest.fn().mockResolvedValue(undefined)
  const prisma = { name: 'app-prisma' }
  const env = { ...baseEnvironment, ...overrides }
  const allowedOrigins = ['https://app.example.com', 'https://admin.example.com']

  jest.doMock('better-auth', () => ({ betterAuth }))
  jest.doMock('better-auth/plugins', () => ({ emailOTP }))
  jest.doMock('@better-auth/prisma-adapter', () => ({ prismaAdapter }))
  jest.doMock('../src/config/db.js', () => ({ prisma }))
  jest.doMock('../src/config/env.js', () => ({ env }))
  jest.doMock('../src/config/cors.js', () => ({ allowedOrigins }))
  jest.doMock('../src/config/mail.js', () => ({ sendEmail }))

  let auth: unknown
  jest.isolateModules(() => { auth = require('../src/config/auth').auth })
  return { auth, options: betterAuth.mock.calls[0][0], pluginOptions: emailOTP.mock.calls[0][0], betterAuth, emailOTP, prismaAdapter, sendEmail, prisma, env, allowedOrigins }
}

describe('app auth configuration', () => {
  afterEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('configures app identity, secure persistence, trusted origins, and production cookies', () => {
    const loaded = loadAuth()
    expect(loaded.betterAuth).toHaveBeenCalledTimes(1)
    expect(loaded.auth).toEqual({ options: loaded.options })
    expect(loaded.prismaAdapter).toHaveBeenCalledWith(loaded.prisma, { provider: 'postgresql', transaction: true })
    expect(loaded.options).toMatchObject({
      appName: 'AERoute',
      baseURL: loaded.env.BETTER_AUTH_URL,
      secret: loaded.env.BETTER_AUTH_SECRET,
      database: { adapter: 'prisma' },
      user: { modelName: 'msUser' },
      account: { modelName: 'msAccount', encryptOAuthTokens: true },
      verification: { modelName: 'trVerification', storeIdentifier: 'hashed' },
      trustedOrigins: loaded.allowedOrigins,
      advanced: { useSecureCookies: true, trustedProxyHeaders: true },
    })
  })

  it('locks session, password, and database-backed rate-limit policy', () => {
    const { options } = loadAuth()
    expect(options.session).toEqual({ modelName: 'trSession', expiresIn: 604800, updateAge: 86400 })
    expect(options.emailAndPassword).toMatchObject({ enabled: true, requireEmailVerification: false, minPasswordLength: 8, maxPasswordLength: 128, revokeSessionsOnPasswordReset: true })
    expect(options.rateLimit).toEqual({
      enabled: true,
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
    })
  })

  it('enables Google only when both credentials exist and disables test rate limiting', () => {
    expect(loadAuth().options.socialProviders).toEqual({ google: { clientId: 'google-client', clientSecret: 'google-secret' } })
    expect(loadAuth({ GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined } as never).options.socialProviders).toBeUndefined()
    expect(loadAuth({ NODE_ENV: 'test', TRUST_PROXY: false }).options).toMatchObject({ advanced: { useSecureCookies: false, trustedProxyHeaders: false }, rateLimit: { enabled: false } })
  })

  it('configures hashed rotating OTPs and sends only forget-password mail', async () => {
    const { options, pluginOptions, emailOTP, sendEmail } = loadAuth()
    expect(emailOTP).toHaveBeenCalledTimes(1)
    expect(options.plugins).toEqual([{ id: 'email-otp', options: pluginOptions }])
    expect(pluginOptions).toMatchObject({ otpLength: 6, expiresIn: 300, allowedAttempts: 3, storeOTP: 'hashed', resendStrategy: 'rotate', rateLimit: { window: 60, max: 3 } })

    await pluginOptions.sendVerificationOTP({ email: 'person@example.com', otp: '123456', type: 'sign-in' })
    expect(sendEmail).not.toHaveBeenCalled()
    await pluginOptions.sendVerificationOTP({ email: 'person@example.com', otp: '123456', type: 'forget-password' })
    expect(sendEmail).toHaveBeenCalledWith('person@example.com', 'Your AERoute security code', expect.stringContaining('123456'))
    expect(sendEmail.mock.calls[0][2]).toContain('5 minutes')
  })

  it('executes the password-reset mail callback with the user and URL', async () => {
    const { options, sendEmail } = loadAuth()
    await options.emailAndPassword.sendResetPassword({ user: { email: 'person@example.com' }, url: 'https://app.example.com/reset?token=safe' })
    expect(sendEmail).toHaveBeenCalledWith('person@example.com', 'Reset your AERoute password', 'Open this link to create a new password: https://app.example.com/reset?token=safe')
  })
})
