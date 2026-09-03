import type { Express, RequestHandler } from 'express'
import swaggerUi from 'swagger-ui-express'
import { env } from './env.js'

type Schema = Record<string, unknown>

export const API_ENDPOINTS = { placePhotos: '/api/v1/place-photos', transitStopDetails: '/api/v1/transit-stop-details' } as const

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
    { name: 'Routes', description: 'Walking, cycling, and transit route intelligence.' },
    { name: 'Reports', description: 'Community road reports, verification, and report images.' },
    { name: 'Insights', description: 'Saved commute watch configuration and modeled completed-trip impact.' },
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
      BikeTransitUnavailableError: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'retryable'],
            properties: { code: { type: 'string', const: 'bike_transit_unavailable' }, message: { type: 'string' }, retryable: { type: 'boolean', const: false } },
          },
        },
      },
      Coordinate: {
        type: 'object',
        required: ['latitude', 'longitude'],
        properties: {
          latitude: { type: 'number', minimum: -90, maximum: 90, example: -6.2088 },
          longitude: { type: 'number', minimum: -180, maximum: 180, example: 106.8456 },
        },
      },
      AccessPlan: {
        type: 'object',
        additionalProperties: false,
        required: ['firstMileMode', 'lastMileMode', 'bicyclePlan'],
        properties: {
          firstMileMode: { type: 'string', const: 'BICYCLE' },
          lastMileMode: { type: 'string', const: 'WALK' },
          bicyclePlan: { type: 'string', const: 'PARK_AT_FIRST_TRANSIT_STOP' },
        },
      },
      RouteComparisonRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['origin', 'destination', 'mode', 'preference'],
        allOf: [{
          if: { required: ['accessPlan'] },
          then: {
            required: ['departureOffsetsMinutes', 'includeRestStops'],
            properties: {
              mode: { const: 'TRANSIT' },
              accessibilityMode: { enum: ['STANDARD', 'REDUCED_EXERTION'] },
              departureOffsetsMinutes: { const: [0] },
              includeRestStops: { const: false },
            },
          },
        }],
        properties: {
          origin: { $ref: '#/components/schemas/Coordinate' },
          destination: { $ref: '#/components/schemas/Coordinate' },
          mode: { type: 'string', enum: ['WALK', 'BICYCLE', 'TRANSIT'] },
          preference: { type: 'string', enum: ['balanced', 'lower-exposure'] },
          sensitiveUser: { type: 'boolean', default: false },
          transitModes: { type: 'array', uniqueItems: true, minItems: 1, items: { type: 'string', enum: ['BUS', 'TRAIN', 'SUBWAY', 'LIGHT_RAIL', 'RAIL'] } },
          transitPreference: { type: 'string', enum: ['LESS_WALKING', 'FEWER_TRANSFERS'] },
          accessibilityMode: { type: 'string', enum: ['STANDARD', 'REDUCED_EXERTION', 'STEP_FREE_REQUIRED'], default: 'STANDARD', description: 'STEP_FREE_REQUIRED is rejected because step-free routing cannot be verified. REDUCED_EXERTION is an approximation only.' },
          departureOffsetsMinutes: { type: 'array', uniqueItems: true, minItems: 1, maxItems: 3, default: [0, 30, 60], items: { type: 'integer', enum: [0, 30, 60] } },
          hazardPolicy: { type: 'string', enum: ['ADVISORY_ONLY', 'PREFER_FEWER_REPORTS'], default: 'PREFER_FEWER_REPORTS' },
          includeRestStops: { type: 'boolean', default: true },
          accessPlan: { $ref: '#/components/schemas/AccessPlan' },
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
          targetTime: { type: 'string', format: 'date-time' },
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
      HazardReportSignal: {
        type: 'object',
        required: ['id', 'category', 'distanceMeters', 'confidence', 'confirmations', 'disputes'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          category: { type: 'string', enum: ['HAZARD', 'BLOCKED_PATH', 'CRASH', 'CONSTRUCTION', 'MAP_ISSUE'] },
          distanceMeters: { type: 'integer', minimum: 0 },
          confidence: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          confirmations: { type: 'integer', minimum: 0 },
          disputes: { type: 'integer', minimum: 0 },
        },
      },
      HazardSummary: {
        type: 'object',
        description: 'Active community report signals near the route. This does not certify route conditions or absence of hazards.',
        required: ['level', 'reports', 'nearbyCount', 'confirmedCount', 'confirmedReportSignalScore', 'fewerConfirmedReportSignals', 'limitations'],
        properties: {
          level: { type: 'string', enum: ['NONE_REPORTED', 'LOW', 'MEDIUM', 'HIGH'] },
          reports: { type: 'array', items: { $ref: '#/components/schemas/HazardReportSignal' } },
          nearbyCount: { type: 'integer', minimum: 0 },
          confirmedCount: { type: 'integer', minimum: 0 },
          confirmedReportSignalScore: { type: 'integer', minimum: 0, description: 'Severity, confidence, and independent net-confirmation weighted report evidence.' },
          fewerConfirmedReportSignals: { type: 'integer', minimum: 0, description: 'Difference from the route with the most independently confirmed report signals in this comparison. This is not a count of physical hazards avoided.' },
          limitations: { type: 'array', items: { type: 'string' } },
        },
      },
      RouteConfidence: {
        type: 'object',
        description: 'Evidence completeness score, not a probability.',
        required: ['score', 'level', 'kind', 'isProbability', 'factors', 'limitations'],
        properties: {
          score: { type: 'integer', minimum: 0, maximum: 100 },
          level: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          kind: { type: 'string', const: 'EVIDENCE_COMPLETENESS' },
          isProbability: { type: 'boolean', const: false },
          factors: { type: 'object', required: ['airQualityCoverage', 'weatherCoverage', 'hazardCoverage', 'routeProvider'], properties: { airQualityCoverage: { type: 'integer', minimum: 0, maximum: 50 }, weatherCoverage: { type: 'integer', minimum: 0, maximum: 20 }, hazardCoverage: { type: 'integer', minimum: 0, maximum: 15 }, routeProvider: { type: 'integer', minimum: 0, maximum: 15 } } },
          limitations: { type: 'array', items: { type: 'string' } },
        },
      },
      HeatUvSummary: {
        type: 'object',
        required: ['status', 'maxFeelsLikeC', 'maxHeatIndexC', 'maxUvIndex', 'breakRecommendation', 'reasons'],
        properties: { status: { type: 'string', enum: ['AVAILABLE', 'UNAVAILABLE'] }, maxFeelsLikeC: { type: ['number', 'null'] }, maxHeatIndexC: { type: ['number', 'null'] }, maxUvIndex: { type: ['integer', 'null'] }, breakRecommendation: { type: 'string', enum: ['NONE', 'CONSIDER', 'RECOMMENDED'] }, reasons: { type: 'array', items: { type: 'string' } } },
      },
      TransitStation: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, location: { $ref: '#/components/schemas/Coordinate' } },
      },
      TransitSegment: {
        type: 'object',
        required: ['travelMode'],
        properties: { travelMode: { type: 'string' }, durationSeconds: { type: 'number', minimum: 0 }, distanceMeters: { type: 'number', minimum: 0 }, encodedPolyline: { type: 'string' }, startLocation: { $ref: '#/components/schemas/Coordinate' }, endLocation: { $ref: '#/components/schemas/Coordinate' }, lineName: { type: 'string' }, lineShortName: { type: 'string' }, vehicleType: { type: 'string' }, headsign: { type: 'string' }, departureTime: { type: 'string', format: 'date-time' }, arrivalTime: { type: 'string', format: 'date-time' }, departureStop: { $ref: '#/components/schemas/TransitStation' }, arrivalStop: { $ref: '#/components/schemas/TransitStation' }, stopCount: { type: 'integer', minimum: 0 } },
      },
      CompositeTransitSegment: {
        type: 'object',
        required: ['role', 'source', 'mode', 'durationSeconds', 'distanceMeters'],
        properties: { role: { type: 'string', enum: ['FIRST_MILE', 'WAIT', 'TRANSIT_RIDE', 'TRANSFER_WALK', 'LAST_MILE'] }, source: { type: 'string', enum: ['GOOGLE_ROUTES', 'DERIVED_FROM_TRANSIT_SCHEDULE'] }, mode: { type: 'string', enum: ['BICYCLE', 'WAIT', 'TRANSIT', 'WALK'] }, durationSeconds: { type: 'number', minimum: 0 }, distanceMeters: { type: 'number', minimum: 0 }, encodedPolyline: { type: 'string' }, location: { $ref: '#/components/schemas/Coordinate' }, startLocation: { $ref: '#/components/schemas/Coordinate' }, endLocation: { $ref: '#/components/schemas/Coordinate' }, lineName: { type: 'string' }, lineShortName: { type: 'string' }, vehicleType: { type: 'string' }, headsign: { type: 'string' }, departureTime: { type: 'string', format: 'date-time' }, arrivalTime: { type: 'string', format: 'date-time' }, departureStop: { $ref: '#/components/schemas/TransitStation' }, arrivalStop: { $ref: '#/components/schemas/TransitStation' }, stopCount: { type: 'integer', minimum: 0 } },
      },
      TransitSummary: {
        type: 'object',
        required: ['walkingDurationSeconds', 'walkingDistanceMeters', 'transfers', 'segments', 'stations'],
        properties: { walkingDurationSeconds: { type: ['number', 'null'], minimum: 0 }, walkingDistanceMeters: { type: ['number', 'null'], minimum: 0 }, transfers: { type: 'integer', minimum: 0 }, segments: { type: 'array', items: { oneOf: [{ $ref: '#/components/schemas/TransitSegment' }, { $ref: '#/components/schemas/CompositeTransitSegment' }] } }, stations: { type: 'array', items: { $ref: '#/components/schemas/TransitStation' } }, preferredTransitModes: { type: 'array', items: { type: 'string' } }, actualTransitModes: { type: 'array', items: { type: 'string' } } },
      },
      RouteAccessibility: {
        type: 'object',
        description: 'REDUCED_EXERTION is approximate. No wheelchair-safe or step-free claim.',
        required: ['mode', 'assessment', 'reasons', 'limitations'],
        properties: { mode: { type: 'string', enum: ['STANDARD', 'REDUCED_EXERTION'] }, assessment: { type: 'string', enum: ['STANDARD', 'APPROXIMATION'] }, reasons: { type: 'array', items: { type: 'string' } }, limitations: { type: 'array', items: { type: 'string' } } },
      },
      NavigationStep: {
        type: 'object',
        required: ['instruction', 'travelMode'],
        properties: { instruction: { type: 'string' }, maneuver: { type: 'string' }, travelMode: { type: 'string' }, durationSeconds: { type: 'number', minimum: 0 }, distanceMeters: { type: 'number', minimum: 0 }, encodedPolyline: { type: 'string' }, startLocation: { $ref: '#/components/schemas/Coordinate' }, endLocation: { $ref: '#/components/schemas/Coordinate' } },
      },
      RouteOption: {
        type: 'object',
        required: ['id', 'labels', 'providerLabels', 'durationSeconds', 'distanceMeters', 'estimatedExposureIndex', 'averagePm25', 'reductionFromFastestPercent', 'reductionPercent', 'exposureUnit', 'dataQuality', 'airQualityTimestamp', 'encodedPolyline', 'airQualitySampleCount', 'airQualityExpectedSampleCount', 'airQualitySamples', 'hazardSummary', 'confidence', 'explanation', 'heatUv', 'weatherConditions', 'accessibility'],
        properties: {
          id: { type: 'string', description: 'Route-provider candidate ID, stable only within this response.' },
          routeResultId: { type: 'string', format: 'uuid', description: 'Stable persisted route-result ID for authenticated comparisons.' },
          labels: { type: 'array', items: { type: 'string', enum: ['FASTEST', 'LOWEST_EXPOSURE', 'RECOMMENDED'] } },
          providerLabels: { type: 'array', items: { type: 'string' } },
          durationSeconds: { type: 'number', minimum: 0 },
          distanceMeters: { type: 'number', minimum: 0 },
          estimatedExposureIndex: { type: ['number', 'null'], minimum: 0 },
          averagePm25: { type: ['number', 'null'], minimum: 0 },
          reductionFromFastestPercent: { type: ['integer', 'null'], minimum: 0 },
          reductionPercent: { type: ['integer', 'null'], minimum: 0 },
          exposureUnit: { type: 'string', const: 'ug_m3_minutes' },
          dataQuality: { type: 'string', enum: ['modeled_estimate', 'partial_estimate', 'unavailable'] },
          airQualityTimestamp: { type: ['string', 'null'], format: 'date-time' },
          encodedPolyline: { type: 'string' },
          airQualitySampleCount: { type: 'integer', minimum: 0 },
          airQualityExpectedSampleCount: { type: 'integer', minimum: 1 },
          airQualitySamples: { type: 'array', items: { $ref: '#/components/schemas/AirQualitySample' } },
          hazardSummary: { $ref: '#/components/schemas/HazardSummary' },
          confidence: { $ref: '#/components/schemas/RouteConfidence' },
          explanation: { type: 'object', required: ['summary', 'reasons', 'tradeoffs', 'limitations', 'ruleVersion'], properties: { summary: { type: 'string' }, reasons: { type: 'array', items: { type: 'string' } }, tradeoffs: { type: 'array', items: { type: 'string' } }, limitations: { type: 'array', items: { type: 'string' } }, ruleVersion: { type: 'string', const: 'route-ranking-v2' } } },
          heatUv: { $ref: '#/components/schemas/HeatUvSummary' },
          weatherConditions: { type: 'array', items: { $ref: '#/components/schemas/WeatherConditions' } },
          navigationSteps: { type: 'array', items: { $ref: '#/components/schemas/NavigationStep' } },
          transitSummary: { $ref: '#/components/schemas/TransitSummary' },
          composition: { type: 'string', const: 'PROVIDER_SEGMENTS' },
          scheduleStatus: { type: 'string', const: 'SCHEDULE_VALIDATED' },
          limitations: { type: 'array', items: { type: 'string' } },
          accessibility: { $ref: '#/components/schemas/RouteAccessibility' },
        },
      },
      WeatherAdvisory: {
        type: 'object',
        required: ['level', 'reasons', 'ruleVersion'],
        properties: {
          level: { type: 'string', enum: ['NORMAL', 'CAUTION', 'DELAY', 'UNAVAILABLE'] },
          reasons: {
            type: 'array',
            items: {
              type: 'object',
              required: ['code', 'message'],
              properties: { code: { type: 'string' }, message: { type: 'string' } },
            },
          },
          ruleVersion: { type: 'string', const: 'weather-advisory-v2' },
        },
      },
      DepartureComparison: {
        oneOf: [
          { type: 'object', required: ['offsetMinutes', 'status', 'routes', 'recommendedRouteId', 'temporalResolution', 'approximate', 'weatherAdvisory', 'heatUv'], properties: { offsetMinutes: { type: 'integer', enum: [0, 30, 60] }, status: { type: 'string', const: 'AVAILABLE' }, routes: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/RouteOption' } }, recommendedRouteId: { type: 'string' }, temporalResolution: { type: 'string', enum: ['CURRENT_CONDITIONS', 'HOURLY_BUCKET'] }, approximate: { type: 'boolean' }, weatherAdvisory: { $ref: '#/components/schemas/WeatherAdvisory' }, heatUv: { $ref: '#/components/schemas/HeatUvSummary' } } },
          { type: 'object', required: ['offsetMinutes', 'status', 'routes', 'recommendedRouteId', 'temporalResolution', 'approximate', 'warning'], properties: { offsetMinutes: { type: 'integer', enum: [0, 30, 60] }, status: { type: 'string', const: 'UNAVAILABLE' }, routes: { type: 'array', maxItems: 0 }, recommendedRouteId: { type: 'null' }, temporalResolution: { type: 'string', const: 'HOURLY_BUCKET' }, approximate: { type: 'boolean', const: true }, warning: { type: 'string' } } },
        ],
      },
      PlacePhoto: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', pattern: '^places/[A-Za-z0-9_-]{1,256}/photos/[A-Za-z0-9_-]{1,512}$', maxLength: 783 }, widthPx: { type: 'integer', minimum: 1 }, heightPx: { type: 'integer', minimum: 1 }, googleMapsUri: { type: 'string', format: 'uri', pattern: '^https://([A-Za-z0-9-]+\\.)*google\\.com/' }, flagContentUri: { type: 'string', format: 'uri', pattern: '^https://([A-Za-z0-9-]+\\.)*google\\.com/' }, authorAttributions: { type: 'array', maxItems: 20, items: { type: 'object', required: ['displayName'], properties: { displayName: { type: 'string', maxLength: 256 }, uri: { type: 'string', format: 'uri', pattern: '^https://' }, photoUri: { type: 'string', format: 'uri', pattern: '^https://' } } } } },
      },
      RestStopCandidate: {
        type: 'object',
        required: ['id', 'name', 'location', 'types', 'safetyVerified'],
        properties: { id: { type: 'string' }, associationId: { type: 'string', format: 'uuid' }, name: { type: 'string' }, formattedAddress: { type: 'string' }, location: { $ref: '#/components/schemas/Coordinate' }, types: { type: 'array', items: { type: 'string' } }, openNow: { type: 'boolean' }, restroom: { type: 'boolean' }, accessibility: { type: 'object', properties: { wheelchairAccessibleEntrance: { type: 'boolean' }, wheelchairAccessibleParking: { type: 'boolean' }, wheelchairAccessibleRestroom: { type: 'boolean' }, wheelchairAccessibleSeating: { type: 'boolean' } } }, googleMapsUri: { type: 'string', format: 'uri' }, photos: { type: 'array', maxItems: 3, items: { $ref: '#/components/schemas/PlacePhoto' } }, safetyVerified: { type: 'boolean', const: false } },
      },
      RestStopResult: {
        oneOf: [
          { type: 'object', required: ['status', 'candidates'], properties: { status: { type: 'string', enum: ['AVAILABLE', 'NOT_REQUESTED'] }, candidates: { type: 'array', maxItems: 5, items: { $ref: '#/components/schemas/RestStopCandidate' } } } },
          { type: 'object', required: ['status', 'candidates', 'warning'], properties: { status: { type: 'string', const: 'UNAVAILABLE' }, candidates: { type: 'array', maxItems: 0 }, warning: { type: 'string' } } },
        ],
      },
      TransitStopDetailsRequest: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'latitude', 'longitude'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 160, pattern: '^[^\\u0000-\\u001F\\u007F-\\u009F]+$' },
          latitude: { type: 'number', minimum: -90, maximum: 90 },
          longitude: { type: 'number', minimum: -180, maximum: 180 },
          routeResultId: { type: 'string', format: 'uuid' },
          ordinal: { type: 'integer', minimum: 0, maximum: 99 },
          role: { type: 'string', enum: ['departure', 'arrival'] },
        },
        allOf: [{
          if: { anyOf: [{ required: ['routeResultId'] }, { required: ['ordinal'] }, { required: ['role'] }] },
          then: { required: ['routeResultId', 'ordinal', 'role'] },
        }],
      },
      TransitStopPlace: {
        allOf: [
          { $ref: '#/components/schemas/RestStopCandidate' },
          { type: 'object', properties: { parkingOptions: { type: 'object', properties: { freeParkingLot: { type: 'boolean' }, paidParkingLot: { type: 'boolean' }, freeStreetParking: { type: 'boolean' }, paidStreetParking: { type: 'boolean' }, valetParking: { type: 'boolean' }, freeGarageParking: { type: 'boolean' }, paidGarageParking: { type: 'boolean' } } } } },
        ],
      },
      TransitStopDetailsResult: {
        oneOf: [
          { type: 'object', required: ['status', 'place'], properties: { status: { type: 'string', const: 'AVAILABLE' }, place: { $ref: '#/components/schemas/TransitStopPlace' } } },
          { type: 'object', required: ['status'], properties: { status: { type: 'string', const: 'NOT_FOUND' } } },
        ],
      },
      RouteComparison: {
        type: 'object',
        required: ['comparisonId', 'persisted', 'routes', 'departureComparisons', 'cleanestDeparture', 'calculationVersion', 'sourceDisclosure', 'warnings', 'weather', 'weatherPoints', 'weatherPointsByRoute', 'weatherAdvisory', 'heatUv', 'restStopCandidates'],
        allOf: [
          { if: { properties: { persisted: { const: false } } }, then: { properties: { routes: { items: { not: { required: ['routeResultId'] } } } } } },
          { if: { properties: { persisted: { const: true } } }, then: { properties: { routes: { items: { required: ['routeResultId'] } } } } },
        ],
        properties: {
          comparisonId: { type: 'string', format: 'uuid' },
          persisted: { type: 'boolean', description: 'True for authenticated comparisons stored for secure trip-impact recording.' },
          routes: { type: 'array', minItems: 1, items: { $ref: '#/components/schemas/RouteOption' }, description: 'Current departure routes. Each route includes routeResultId when persisted is true.' },
          departureComparisons: { type: 'array', items: { $ref: '#/components/schemas/DepartureComparison' } },
          cleanestDeparture: { type: ['integer', 'null'], enum: [0, 30, 60, null], description: 'Window containing the minimum modeled exposure, or null when air quality is unavailable.' },
          calculationVersion: { type: 'string', const: 'route-intelligence-v2' },
          sourceDisclosure: { type: 'object', required: ['route', 'airQuality', 'weather', 'places', 'communityReports', 'temporalResolution', 'customScore'], properties: { route: { type: 'string' }, airQuality: { type: 'string' }, weather: { type: 'string' }, places: { type: 'string' }, communityReports: { type: 'string' }, temporalResolution: { type: 'string' }, customScore: { type: 'boolean', const: true } } },
          warnings: { type: 'array', items: { type: 'string' } },
          weather: { $ref: '#/components/schemas/WeatherConditions' },
          weatherPoints: { type: 'array', items: { $ref: '#/components/schemas/WeatherPoint' } },
          weatherPointsByRoute: { type: 'object', additionalProperties: { type: 'array', items: { $ref: '#/components/schemas/WeatherPoint' } } },
          weatherAdvisory: { $ref: '#/components/schemas/WeatherAdvisory' },
          heatUv: { $ref: '#/components/schemas/HeatUvSummary' },
          restStopCandidates: { $ref: '#/components/schemas/RestStopResult' },
        },
      },
      ReportEvidence: {
        type: 'object',
        required: ['verification', 'evidence'],
        properties: {
          verification: {
            type: 'object',
            required: ['confirmations', 'disputes', 'viewerVerdict'],
            properties: {
              confirmations: { type: 'integer', minimum: 0 },
              disputes: { type: 'integer', minimum: 0 },
              viewerVerdict: { type: ['string', 'null'], enum: ['CONFIRM', 'DISPUTE', null] },
            },
          },
          evidence: {
            type: 'object',
            required: ['level', 'score', 'kind', 'factors'],
            description: 'Transparent evidence score derived from recency, attached photos, and independent net confirmations. HIGH requires at least two net confirmations. It is not a safety probability.',
            properties: {
              level: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
              score: { type: 'integer', minimum: 0, maximum: 100 },
              kind: { type: 'string', const: 'EVIDENCE_SCORE' },
              factors: {
                type: 'object',
                required: ['recency', 'photos', 'voteBalance'],
                properties: {
                  recency: { type: 'integer', minimum: 0, maximum: 40 },
                  photos: { type: 'integer', minimum: 0, maximum: 30 },
                  voteBalance: { type: 'integer', minimum: 0, maximum: 30 },
                },
              },
            },
          },
        },
      },
      RoadReport: {
        allOf: [
          { $ref: '#/components/schemas/ReportEvidence' },
          {
            type: 'object',
            required: ['id', 'category', 'description', 'latitude', 'longitude', 'createdAt', 'expiresAt', 'resolvedAt', 'status', 'images', 'reporter', 'isOwner'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              category: { type: 'string', enum: ['HAZARD', 'BLOCKED_PATH', 'CRASH', 'CONSTRUCTION', 'MAP_ISSUE'] },
              description: { type: 'string', minLength: 10, maxLength: 500 },
              latitude: { type: 'number' },
              longitude: { type: 'number' },
              createdAt: { type: 'string', format: 'date-time' },
              expiresAt: { type: 'string', format: 'date-time' },
              resolvedAt: { type: ['string', 'null'], format: 'date-time' },
              status: { type: 'string', enum: ['ACTIVE', 'RESOLVED', 'EXPIRED'] },
              images: { type: 'array', maxItems: 3, items: { type: 'string', example: '/api/v1/road-report-images/uuid' } },
              reporter: { type: 'string' },
              isOwner: { type: 'boolean' },
            },
          },
        ],
      },
      SavedCommuteInput: {
        type: 'object',
        required: ['name', 'origin', 'destination', 'mode', 'preference'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          origin: { allOf: [{ $ref: '#/components/schemas/Coordinate' }], properties: { label: { type: 'string', minLength: 1, maxLength: 180 } }, required: ['label', 'latitude', 'longitude'] },
          destination: { allOf: [{ $ref: '#/components/schemas/Coordinate' }], properties: { label: { type: 'string', minLength: 1, maxLength: 180 } }, required: ['label', 'latitude', 'longitude'] },
          mode: { type: 'string', enum: ['WALK', 'BICYCLE', 'TRANSIT'] },
          preference: { type: 'string', enum: ['balanced', 'lower-exposure'] },
          transitModes: { type: 'array', uniqueItems: true, maxItems: 5, default: [], items: { type: 'string', enum: ['BUS', 'TRAIN', 'SUBWAY', 'LIGHT_RAIL', 'RAIL'] } },
          transitPreference: { type: ['string', 'null'], enum: ['LESS_WALKING', 'FEWER_TRANSFERS', null], default: null },
          accessibilityMode: { type: 'string', enum: ['STANDARD', 'REDUCED_EXERTION'], default: 'STANDARD' },
          sensitiveUser: { type: 'boolean', default: false },
          watchEnabled: { type: 'boolean', default: true },
          watchHour: { type: ['integer', 'null'], minimum: 0, maximum: 23, description: 'Local hour configuration only. No background push delivery is implied.' },
        },
      },
      SavedCommutePatch: {
        type: 'object',
        minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 80 },
          origin: { allOf: [{ $ref: '#/components/schemas/Coordinate' }], properties: { label: { type: 'string', minLength: 1, maxLength: 180 } }, required: ['label', 'latitude', 'longitude'] },
          destination: { allOf: [{ $ref: '#/components/schemas/Coordinate' }], properties: { label: { type: 'string', minLength: 1, maxLength: 180 } }, required: ['label', 'latitude', 'longitude'] },
          mode: { type: 'string', enum: ['WALK', 'BICYCLE', 'TRANSIT'] },
          preference: { type: 'string', enum: ['balanced', 'lower-exposure'] },
          transitModes: { type: 'array', uniqueItems: true, maxItems: 5, items: { type: 'string', enum: ['BUS', 'TRAIN', 'SUBWAY', 'LIGHT_RAIL', 'RAIL'] } },
          transitPreference: { type: ['string', 'null'], enum: ['LESS_WALKING', 'FEWER_TRANSFERS', null] },
          accessibilityMode: { type: 'string', enum: ['STANDARD', 'REDUCED_EXERTION'] },
          sensitiveUser: { type: 'boolean' },
          watchEnabled: { type: 'boolean' },
          watchHour: { type: ['integer', 'null'], minimum: 0, maximum: 23 },
        },
      },
      SavedCommute: {
        allOf: [{ $ref: '#/components/schemas/SavedCommuteInput' }, { type: 'object', required: ['id', 'transitModes', 'transitPreference', 'accessibilityMode', 'sensitiveUser', 'watchEnabled', 'watchHour', 'createdAt', 'updatedAt'], properties: { id: { type: 'string', format: 'uuid' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } }],
      },
      TripImpactInput: {
        type: 'object',
        additionalProperties: false,
        required: ['routeResultId'],
        properties: {
          routeResultId: { type: 'string', format: 'uuid' },
        },
      },
      TripImpact: {
        type: 'object',
        required: ['id', 'comparisonId', 'routeResultId', 'mode', 'distanceMeters', 'durationSeconds', 'activeDistanceMeters', 'activeDurationSeconds', 'baselineExposureIndex', 'selectedExposureIndex', 'fewerConfirmedReportSignals', 'completedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          comparisonId: { type: 'string', format: 'uuid' },
          routeResultId: { type: 'string', format: 'uuid' },
          mode: { type: 'string', enum: ['WALK', 'BICYCLE', 'TRANSIT'] },
          distanceMeters: { type: 'integer', minimum: 0 },
          durationSeconds: { type: 'integer', minimum: 0 },
          activeDistanceMeters: { type: 'integer', minimum: 0 },
          activeDurationSeconds: { type: 'integer', minimum: 0 },
          baselineExposureIndex: { type: 'number', minimum: 0 },
          selectedExposureIndex: { type: 'number', minimum: 0 },
          fewerConfirmedReportSignals: { type: 'integer', minimum: 0 },
          completedAt: { type: 'string', format: 'date-time' },
        },
      },
      TripImpactSummary: {
        type: 'object',
        required: ['completedTrips', 'activeTravelDistanceMeters', 'activeTravelDurationSeconds', 'modeledExposureIndexBaseline', 'modeledExposureIndexSelected', 'modeledExposureIndexReduction', 'fewerConfirmedReportSignals', 'disclaimer'],
        properties: {
          completedTrips: { type: 'integer', minimum: 0 },
          activeTravelDistanceMeters: { type: 'integer', minimum: 0 },
          activeTravelDurationSeconds: { type: 'integer', minimum: 0 },
          modeledExposureIndexBaseline: { type: 'number', minimum: 0 },
          modeledExposureIndexSelected: { type: 'number', minimum: 0 },
          modeledExposureIndexReduction: { type: 'number', minimum: 0 },
          fewerConfirmedReportSignals: { type: 'integer', minimum: 0 },
          disclaimer: { type: 'string' },
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
    [API_ENDPOINTS.placePhotos]: {
      get: {
        tags: ['Routes'],
        summary: 'Read a Google Place photo',
        security: [{ cookieAuth: [] }],
        parameters: [{ name: 'name', in: 'query', required: true, schema: { type: 'string', pattern: '^places/[A-Za-z0-9_-]{1,256}/photos/[A-Za-z0-9_-]{1,512}$', maxLength: 783 } }],
        responses: {
          200: { description: 'Place image', content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } }, 'image/webp': { schema: { type: 'string', format: 'binary' } }, 'image/gif': { schema: { type: 'string', format: 'binary' } } } },
          400: errorResponse,
          401: errorResponse,
          404: errorResponse,
          429: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    },
    [API_ENDPOINTS.transitStopDetails]: {
      post: {
        tags: ['Routes'],
        summary: 'Read on-demand transit stop details',
        security: [{ cookieAuth: [] }],
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/TransitStopDetailsRequest' }) },
        responses: {
          200: { ...success({ $ref: '#/components/schemas/TransitStopDetailsResult' }), headers: { 'Cache-Control': { schema: { type: 'string', const: 'private, no-store' } } } },
          400: errorResponse,
          401: errorResponse,
          404: errorResponse,
          429: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    },
    '/api/v1/route-comparisons': {
      post: {
        tags: ['Routes'],
        summary: 'Compare walking, cycling, or transit routes',
        security: [{ cookieAuth: [] }],
        description: 'Returns current-compatible routes plus departure-window comparisons, modeled PM2.5 exposure, weather heat/UV checkpoints, nearby community-report signals, evidence confidence, explanations, transit details, and optional rest-stop candidates. Authenticated users may request up to 10 comparisons per 5-minute fixed window per API instance. Reduced exertion is approximate; no result certifies route safety, wheelchair access, or step-free travel.',
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
          422: { description: 'Unsupported accessibility or unavailable bicycle-transit composition', content: json({ oneOf: [{ $ref: '#/components/schemas/BikeTransitUnavailableError' }, { $ref: '#/components/schemas/ErrorEnvelope' }] }) },
          429: errorResponse,
          502: errorResponse,
          503: errorResponse,
        },
      },
    },
    '/api/v1/road-reports': {
      get: {
        tags: ['Reports'],
        summary: 'List nearby reports with lifecycle and evidence status',
        description: 'Public endpoint. A valid session optionally supplies viewerVerdict and isOwner. Viewports may cross the antimeridian by supplying west greater than east; latitude and wrapped longitude spans must each be at most 2 degrees.',
        security: [{ cookieAuth: [] }, {}],
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
    '/api/v1/road-reports/mine': {
      get: {
        tags: ['Reports'],
        summary: 'List current user road reports',
        security: [{ cookieAuth: [] }],
        responses: { 200: success({ type: 'array', maxItems: 100, items: { $ref: '#/components/schemas/RoadReport' } }), 401: errorResponse },
      },
    },
    '/api/v1/road-reports/{id}/verification': {
      put: {
        tags: ['Reports'],
        summary: 'Create or update a report verification',
        security: [{ cookieAuth: [] }],
        parameters: [reportImageId],
        requestBody: { required: true, content: json({ type: 'object', required: ['verdict'], properties: { verdict: { type: 'string', enum: ['CONFIRM', 'DISPUTE'] } } }) },
        responses: { 200: success({ $ref: '#/components/schemas/ReportEvidence' }), 400: errorResponse, 401: errorResponse, 404: errorResponse, 409: errorResponse },
      },
      delete: {
        tags: ['Reports'],
        summary: 'Retract current user report verification',
        description: 'Idempotent when no verification exists.',
        security: [{ cookieAuth: [] }],
        parameters: [reportImageId],
        responses: { 200: success({ $ref: '#/components/schemas/ReportEvidence' }), 401: errorResponse, 404: errorResponse },
      },
    },
    '/api/v1/road-reports/{id}': {
      patch: {
        tags: ['Reports'],
        summary: 'Resolve an owned road report',
        security: [{ cookieAuth: [] }],
        parameters: [reportImageId],
        requestBody: { required: true, content: json({ type: 'object', required: ['status'], properties: { status: { type: 'string', const: 'RESOLVED' } } }) },
        responses: { 200: success({ $ref: '#/components/schemas/RoadReport' }), 400: errorResponse, 401: errorResponse, 404: errorResponse, 409: errorResponse },
      },
    },
    '/api/v1/saved-commutes': {
      get: {
        tags: ['Insights'],
        summary: 'List saved commute watch configurations',
        security: [{ cookieAuth: [] }],
        responses: { 200: success({ type: 'array', items: { $ref: '#/components/schemas/SavedCommute' } }), 401: errorResponse },
      },
      post: {
        tags: ['Insights'],
        summary: 'Create saved commute watch configuration',
        description: 'Persists configuration only; it does not claim background push delivery.',
        security: [{ cookieAuth: [] }],
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/SavedCommuteInput' }) },
        responses: { 201: success({ $ref: '#/components/schemas/SavedCommute' }, 'Saved commute created'), 400: errorResponse, 401: errorResponse },
      },
    },
    '/api/v1/saved-commutes/{id}': {
      patch: {
        tags: ['Insights'],
        summary: 'Update owned saved commute',
        security: [{ cookieAuth: [] }],
        parameters: [reportImageId],
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/SavedCommutePatch' }) },
        responses: { 200: success({ $ref: '#/components/schemas/SavedCommute' }), 400: errorResponse, 401: errorResponse, 404: errorResponse },
      },
      delete: {
        tags: ['Insights'],
        summary: 'Delete owned saved commute',
        security: [{ cookieAuth: [] }],
        parameters: [reportImageId],
        responses: { 200: success({ type: 'object', required: ['deleted'], properties: { deleted: { type: 'boolean', const: true } } }), 401: errorResponse, 404: errorResponse },
      },
    },
    '/api/v1/trip-impacts': {
      post: {
        tags: ['Insights'],
        summary: 'Record modeled completed-trip impact',
        description: 'Stores comparative modeled indices, not medical measurements or actual inhaled dose. Limited to 50 records per user per UTC day.',
        security: [{ cookieAuth: [] }],
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/TripImpactInput' }) },
        responses: { 201: success({ $ref: '#/components/schemas/TripImpact' }, 'Trip impact recorded'), 400: errorResponse, 401: errorResponse, 404: errorResponse, 409: errorResponse, 429: errorResponse },
      },
    },
    '/api/v1/trip-impacts/summary': {
      get: {
        tags: ['Insights'],
        summary: 'Summarize current user modeled trip impacts',
        security: [{ cookieAuth: [] }],
        responses: { 200: success({ $ref: '#/components/schemas/TripImpactSummary' }), 401: errorResponse },
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
