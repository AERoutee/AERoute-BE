import type { Express, RequestHandler } from 'express'
import swaggerUi from 'swagger-ui-express'
import { env } from './env.js'

type Schema = Record<string, unknown>

const json = (schema: Schema) => ({ 'application/json': { schema } })
const dataEnvelope = (schema: Schema) => ({ type: 'object', required: ['data'], properties: { data: schema } })
const success = (schema: Schema, description = 'Successful response') => ({ description, content: json(dataEnvelope(schema)) })
const errorResponse = { description: 'Request failed', content: json({ $ref: '#/components/schemas/ErrorEnvelope' }) }
const challengeId = { name: 'id', in: 'path', required: true, schema: { type: 'string', minLength: 43, maxLength: 43 } }
const reportImageId = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }

export const openApiDocument: Record<string, unknown> = {
  openapi: '3.1.0',
  info: {
    title: 'AERoute API',
    version: '0.1.0',
    description: 'AERoute REST API for authentication, route comparison, PM2.5-aware ranking, weather context, profile images, password recovery, and community road reports. Exposure values are modeled estimates and are not medical measurements.',
  },
  servers: [{ url: env.BETTER_AUTH_URL, description: env.NODE_ENV === 'production' ? 'Production API' : 'Local API' }],
  tags: [
    { name: 'Health', description: 'Service readiness.' },
    { name: 'Authentication', description: 'Better Auth endpoints used by the frontend.' },
    { name: 'Recovery', description: 'Opaque challenge and six-digit OTP password recovery.' },
    { name: 'Profile', description: 'Profile image management.' },
    { name: 'Routes', description: 'Walking and cycling route comparison.' },
    { name: 'Reports', description: 'Community road reports and report images.' },
  ],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'better-auth.session_token',
        description: 'Better Auth HTTP-only session cookie. Production may use the __Secure- prefixed cookie variant.',
      },
    },
    schemas: {
      ApiError: {
        type: 'object',
        required: ['code', 'message', 'retryable'],
        properties: {
          code: { type: 'string', example: 'validation_error' },
          message: { type: 'string' },
          retryable: { type: 'boolean' },
          fields: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
      ErrorEnvelope: {
        type: 'object',
        required: ['error'],
        properties: { error: { $ref: '#/components/schemas/ApiError' } },
      },
      Coordinate: {
        type: 'object',
        required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number', minimum: -90, maximum: 90, example: -6.2088 },
          longitude: { type: 'number', minimum: -180, maximum: 180, example: 106.8456 },
        },
      },
      RouteComparisonRequest: {
        type: 'object',
        required: ['origin', 'destination', 'mode', 'preference'],
        properties: {
          origin: { $ref: '#/components/schemas/Coordinate' },
          destination: { $ref: '#/components/schemas/Coordinate' },
          mode: { type: 'string', enum: ['WALK', 'BICYCLE'] },
          preference: { type: 'string', enum: ['balanced', 'lower-exposure'] },
          sensitiveUser: { type: 'boolean', default: false },
        },
      },
      AirQualitySample: {
        type: 'object',
        required: ['latitude', 'longitude', 'pm25'],
        properties: {
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          pm25: { type: 'number', minimum: 0 },
        },
      },
      WeatherUnavailable: {
        type: 'object',
        required: ['status'],
        properties: { status: { type: 'string', const: 'unavailable' } },
      },
      WeatherAvailable: {
        type: 'object',
        required: ['status', 'observedAt', 'forecastOffsetMinutes', 'conditionType', 'condition', 'temperatureC', 'precipitationProbabilityPercent', 'windSpeedKph'],
        properties: {
          status: { type: 'string', const: 'available' },
          observedAt: { type: 'string', format: 'date-time' },
          forecastOffsetMinutes: { type: 'integer', minimum: 0, maximum: 1380 },
          conditionType: { type: 'string', example: 'PARTLY_CLOUDY' },
          condition: { type: 'string', example: 'Partly cloudy' },
          isDaytime: { type: 'boolean' },
          temperatureC: { type: 'number' },
          feelsLikeC: { type: 'number' },
          heatIndexC: { type: 'number' },
          humidityPercent: { type: 'integer', minimum: 0, maximum: 100 },
          uvIndex: { type: 'integer', minimum: 0 },
          precipitationProbabilityPercent: { type: 'integer', minimum: 0, maximum: 100 },
          thunderstormProbabilityPercent: { type: 'integer', minimum: 0, maximum: 100 },
          windSpeedKph: { type: 'number', minimum: 0 },
          windGustKph: { type: 'number', minimum: 0 },
          visibilityKm: { type: 'number', minimum: 0 },
        },
      },
      WeatherConditions: {
        oneOf: [
          { $ref: '#/components/schemas/WeatherAvailable' },
          { $ref: '#/components/schemas/WeatherUnavailable' },
        ],
      },
      WeatherPoint: {
        type: 'object',
        required: ['latitude', 'longitude', 'conditions'],
        properties: {
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          conditions: { $ref: '#/components/schemas/WeatherConditions' },
        },
      },
      RouteOption: {
        type: 'object',
        required: ['id', 'labels', 'durationSeconds', 'distanceMeters', 'estimatedExposureIndex', 'averagePm25', 'reductionPercent', 'dataQuality', 'airQualityTimestamp', 'encodedPolyline', 'airQualitySamples'],
        properties: {
          id: { type: 'string' },
          labels: { type: 'array', items: { type: 'string', enum: ['FASTEST', 'LOWEST_EXPOSURE', 'RECOMMENDED'] } },
          durationSeconds: { type: 'integer', minimum: 0 },
          distanceMeters: { type: 'integer', minimum: 0 },
          estimatedExposureIndex: { type: 'number', minimum: 0 },
          averagePm25: { type: 'number', minimum: 0 },
          reductionPercent: { type: 'integer' },
          dataQuality: { type: 'string', enum: ['modeled_estimate', 'partial_estimate'] },
          airQualityTimestamp: { type: 'string', format: 'date-time' },
          encodedPolyline: { type: 'string' },
          airQualitySamples: { type: 'array', items: { $ref: '#/components/schemas/AirQualitySample' } },
        },
      },
      WeatherAdvisory: {
        type: 'object',
        required: ['level', 'reasons'],
        properties: {
          level: { type: 'string', enum: ['NORMAL', 'CAUTION', 'DELAY'] },
          reasons: {
            type: 'array',
            items: {
              type: 'object',
              required: ['code', 'message'],
              properties: { code: { type: 'string' }, message: { type: 'string' } },
            },
          },
        },
      },
      RouteComparison: {
        type: 'object',
        required: ['routes', 'calculationVersion', 'sourceDisclosure', 'warnings', 'weather', 'weatherPoints', 'weatherPointsByRoute', 'weatherAdvisory'],
        properties: {
          routes: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/RouteOption' } },
          calculationVersion: { type: 'string' },
          sourceDisclosure: { type: 'string' },
          warnings: { type: 'array', items: { type: 'string' } },
          weather: { $ref: '#/components/schemas/WeatherConditions' },
          weatherPoints: { type: 'array', items: { $ref: '#/components/schemas/WeatherPoint' } },
          weatherPointsByRoute: { type: 'object', additionalProperties: { type: 'array', items: { $ref: '#/components/schemas/WeatherPoint' } } },
          weatherAdvisory: { $ref: '#/components/schemas/WeatherAdvisory' },
        },
      },
      RoadReport: {
        type: 'object',
        required: ['id', 'category', 'description', 'latitude', 'longitude', 'createdAt', 'expiresAt', 'images', 'reporter'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          category: { type: 'string', enum: ['HAZARD', 'BLOCKED_PATH', 'CRASH', 'CONSTRUCTION', 'MAP_ISSUE'] },
          description: { type: 'string', minLength: 10, maxLength: 500 },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          createdAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
          images: { type: 'array', maxItems: 3, items: { type: 'string', example: '/api/v1/road-report-images/uuid' } },
          reporter: { type: 'string' },
        },
      },
      RecoveryChallenge: {
        type: 'object',
        required: ['id', 'expiresInSeconds'],
        properties: {
          id: { type: 'string', minLength: 43, maxLength: 43 },
          expiresInSeconds: { type: 'integer', example: 300 },
        },
      },
      RecoveryInfo: {
        type: 'object',
        required: ['maskedEmail', 'expiresAt'],
        properties: {
          maskedEmail: { type: 'string', example: 'ya***@example.com' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      AvatarResult: {
        type: 'object',
        required: ['image'],
        properties: { image: { type: ['string', 'null'], format: 'uri' } },
      },
    },
  },
  paths: {
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Check API health',
        responses: {
          200: success({
            type: 'object',
            required: ['status', 'service'],
            properties: { status: { type: 'string', const: 'ok' }, service: { type: 'string', example: 'aeroute-api' } },
          }),
        },
      },
    },
    '/api/auth/sign-up/email': {
      post: {
        tags: ['Authentication'],
        summary: 'Register with email and password',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['name', 'email', 'password'],
            properties: {
              name: { type: 'string', minLength: 2 },
              email: { type: 'string', format: 'email' },
              password: { type: 'string', format: 'password', minLength: 8, maxLength: 128 },
            },
          }),
        },
        responses: { 200: { description: 'Account created' }, 400: errorResponse, 422: errorResponse, 429: errorResponse },
      },
    },
    '/api/auth/sign-in/email': {
      post: {
        tags: ['Authentication'],
        summary: 'Sign in with email and password',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['email', 'password'],
            properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password' } },
          }),
        },
        responses: { 200: { description: 'Signed in and session cookie created' }, 400: errorResponse, 401: errorResponse, 429: errorResponse },
      },
    },
    '/api/auth/sign-in/social': {
      post: {
        tags: ['Authentication'],
        summary: 'Start Google OAuth sign-in',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['provider', 'callbackURL'],
            properties: {
              provider: { type: 'string', enum: ['google'] },
              callbackURL: { type: 'string', format: 'uri' },
              errorCallbackURL: { type: 'string', format: 'uri' },
            },
          }),
        },
        responses: { 200: { description: 'OAuth redirect information' }, 400: errorResponse },
      },
    },
    '/api/auth/get-session': {
      get: {
        tags: ['Authentication'],
        summary: 'Read current session',
        security: [{ cookieAuth: [] }],
        responses: { 200: { description: 'Current session or null' } },
      },
    },
    '/api/auth/sign-out': {
      post: {
        tags: ['Authentication'],
        summary: 'Sign out current session',
        security: [{ cookieAuth: [] }],
        responses: { 200: { description: 'Signed out' }, 401: errorResponse },
      },
    },
    '/api/auth/update-user': {
      post: {
        tags: ['Authentication'],
        summary: 'Update current user profile',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 100 },
              image: { type: ['string', 'null'], format: 'uri' },
            },
          }),
        },
        responses: { 200: { description: 'User updated' }, 400: errorResponse, 401: errorResponse },
      },
    },
    '/api/auth/change-password': {
      post: {
        tags: ['Authentication'],
        summary: 'Change password and revoke other sessions',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['currentPassword', 'newPassword'],
            properties: {
              currentPassword: { type: 'string', format: 'password' },
              newPassword: { type: 'string', format: 'password', minLength: 8, maxLength: 128 },
              revokeOtherSessions: { type: 'boolean', default: true },
            },
          }),
        },
        responses: { 200: { description: 'Password changed' }, 400: errorResponse, 401: errorResponse },
      },
    },
    '/api/auth/list-accounts': {
      get: {
        tags: ['Authentication'],
        summary: 'List linked sign-in accounts',
        security: [{ cookieAuth: [] }],
        responses: { 200: { description: 'Linked credential and social accounts' }, 401: errorResponse },
      },
    },
    '/api/v1/recovery-challenges': {
      post: {
        tags: ['Recovery'],
        summary: 'Create password recovery challenge',
        description: 'Creates an opaque ID and sends a six-digit OTP. The response does not expose the OTP or raw email.',
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['email'],
            properties: { email: { type: 'string', format: 'email', maxLength: 254 } },
          }),
        },
        responses: { 200: success({ $ref: '#/components/schemas/RecoveryChallenge' }), 400: errorResponse, 429: errorResponse, 503: errorResponse },
      },
    },
    '/api/v1/recovery-challenges/{id}': {
      get: {
        tags: ['Recovery'],
        summary: 'Read recovery challenge status',
        parameters: [challengeId],
        responses: { 200: success({ $ref: '#/components/schemas/RecoveryInfo' }), 404: errorResponse },
      },
    },
    '/api/v1/recovery-challenges/{id}/resend': {
      post: {
        tags: ['Recovery'],
        summary: 'Rotate challenge and resend OTP',
        parameters: [challengeId],
        responses: { 200: success({ $ref: '#/components/schemas/RecoveryChallenge' }), 400: errorResponse, 429: errorResponse },
      },
    },
    '/api/v1/recovery-challenges/{id}/verify': {
      post: {
        tags: ['Recovery'],
        summary: 'Verify recovery OTP',
        parameters: [challengeId],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['otp'],
            properties: { otp: { type: 'string', pattern: '^\\d{6}$', example: '123456' } },
          }),
        },
        responses: { 200: success({ type: 'object', properties: { verified: { type: 'boolean', const: true } } }), 400: errorResponse, 429: errorResponse },
      },
    },
    '/api/v1/recovery-challenges/{id}/reset': {
      post: {
        tags: ['Recovery'],
        summary: 'Consume OTP and reset password',
        parameters: [challengeId],
        requestBody: {
          required: true,
          content: json({
            type: 'object',
            required: ['otp', 'password'],
            properties: {
              otp: { type: 'string', pattern: '^\\d{6}$' },
              password: { type: 'string', format: 'password', minLength: 8, maxLength: 128 },
            },
          }),
        },
        responses: { 200: success({ type: 'object', properties: { success: { type: 'boolean', const: true } } }), 400: errorResponse, 429: errorResponse },
      },
    },
    '/api/v1/profile/avatar/{userId}': {
      get: {
        tags: ['Profile'],
        summary: 'Read processed profile image',
        parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'WebP image', content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } } },
          404: errorResponse,
        },
      },
    },
    '/api/v1/profile/avatar': {
      put: {
        tags: ['Profile'],
        summary: 'Upload or replace profile image',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['avatar'],
                properties: { avatar: { type: 'string', format: 'binary', description: 'JPG, PNG, or WebP. Maximum 5 MB; minimum 64×64.' } },
              },
            },
          },
        },
        responses: { 200: success({ $ref: '#/components/schemas/AvatarResult' }), 400: errorResponse, 401: errorResponse, 413: errorResponse, 503: errorResponse },
      },
      delete: {
        tags: ['Profile'],
        summary: 'Remove current profile image',
        security: [{ cookieAuth: [] }],
        responses: { 200: success({ $ref: '#/components/schemas/AvatarResult' }), 401: errorResponse },
      },
    },
    '/api/v1/route-comparisons': {
      post: {
        tags: ['Routes'],
        summary: 'Compare walking or cycling routes',
        description: 'Returns route alternatives, segment-level PM2.5 samples, weather checkpoints, and route ranking. Signed-in comparisons are persisted.',
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/RouteComparisonRequest' }) },
        responses: {
          200: {
            description: 'Route comparison',
            content: json({
              type: 'object',
              required: ['data', 'stats'],
              properties: {
                data: { $ref: '#/components/schemas/RouteComparison' },
                stats: { type: 'object', properties: { routeCount: { type: 'integer' } } },
              },
            }),
          },
          400: errorResponse,
          422: errorResponse,
          429: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    },
    '/api/v1/road-reports': {
      get: {
        tags: ['Reports'],
        summary: 'List active reports in a map viewport',
        parameters: [
          { name: 'north', in: 'query', required: true, schema: { type: 'number', minimum: -90, maximum: 90 } },
          { name: 'south', in: 'query', required: true, schema: { type: 'number', minimum: -90, maximum: 90 } },
          { name: 'east', in: 'query', required: true, schema: { type: 'number', minimum: -180, maximum: 180 } },
          { name: 'west', in: 'query', required: true, schema: { type: 'number', minimum: -180, maximum: 180 } },
        ],
        responses: { 200: success({ type: 'array', maxItems: 100, items: { $ref: '#/components/schemas/RoadReport' } }), 400: errorResponse },
      },
      post: {
        tags: ['Reports'],
        summary: 'Create community road report',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['category', 'description', 'latitude', 'longitude'],
                properties: {
                  category: { type: 'string', enum: ['HAZARD', 'BLOCKED_PATH', 'CRASH', 'CONSTRUCTION', 'MAP_ISSUE'] },
                  description: { type: 'string', minLength: 10, maxLength: 500 },
                  latitude: { type: 'number', minimum: -90, maximum: 90 },
                  longitude: { type: 'number', minimum: -180, maximum: 180 },
                  images: { type: 'array', maxItems: 3, items: { type: 'string', format: 'binary' }, description: 'Optional JPG, PNG, or WebP images. Maximum 3 MB each.' },
                },
              },
            },
          },
        },
        responses: { 201: success({ $ref: '#/components/schemas/RoadReport' }, 'Report created'), 400: errorResponse, 401: errorResponse, 413: errorResponse, 429: errorResponse, 503: errorResponse },
      },
    },
    '/api/v1/road-report-images/{id}': {
      get: {
        tags: ['Reports'],
        summary: 'Read processed report image',
        parameters: [reportImageId],
        responses: {
          200: { description: 'WebP image', content: { 'image/webp': { schema: { type: 'string', format: 'binary' } } } },
          404: errorResponse,
        },
      },
    },
  },
}

const swaggerOptions = {
  customSiteTitle: 'AERoute API Docs',
  customCss: '.swagger-ui .topbar{display:none}.swagger-ui .info .title{color:#142922}.swagger-ui .opblock.opblock-post{border-color:#087f5b}.swagger-ui .opblock.opblock-post .opblock-summary-method{background:#087f5b}',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    docExpansion: 'list',
    defaultModelsExpandDepth: 1,
    tryItOutEnabled: true,
  },
}

const removeDocsCsp: RequestHandler = (_request, response, next) => {
  response.removeHeader('Content-Security-Policy')
  next()
}

export function mountSwagger(app: Express) {
  app.get('/api/openapi.json', (_request, response) => response.json(openApiDocument))
  app.use('/api/docs', removeDocsCsp, swaggerUi.serve, swaggerUi.setup(openApiDocument, swaggerOptions))
}
