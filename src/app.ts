import { toNodeHandler } from 'better-auth/node'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { auth, corsOptions, env, healthHandler, mountSwagger, prisma } from './config/index.js'
import { errorHandler, notFoundHandler, requestLogger } from './middleware/index.js'
import { InsightsController, InsightsRepository, InsightsService, ProfileController, ProfileRepository, ProfileService, RecoveryController, RecoveryRepository, RecoveryService, RoadReportController, RoadReportRepository, RoadReportService, RouteComparisonController, RouteComparisonRepository, RouteComparisonService, TransitStopDetailsController, TransitStopDetailsService, createInsightsRoutes, createProfileRoutes, createRecoveryRoutes, createRoadReportRoutes, createRouteComparisonRoutes, createTransitStopDetailsRoutes } from './modules/index.js'

const insightsRepository = new InsightsRepository(prisma)
const insightsService = new InsightsService(insightsRepository)
const insightsController = new InsightsController(insightsService)
const profileRepository = new ProfileRepository(prisma)
const profileService = new ProfileService(profileRepository)
const profileController = new ProfileController(profileService)
const recoveryRepository = new RecoveryRepository(prisma)
const recoveryService = new RecoveryService(recoveryRepository)
const recoveryController = new RecoveryController(recoveryService)
const roadReportRepository = new RoadReportRepository(prisma)
const roadReportService = new RoadReportService(roadReportRepository)
const roadReportController = new RoadReportController(roadReportService)
const routeComparisonRepository = new RouteComparisonRepository(prisma)
const routeComparisonService = new RouteComparisonService(routeComparisonRepository, roadReportRepository)
const routeComparisonController = new RouteComparisonController(routeComparisonService)
const transitStopDetailsService = new TransitStopDetailsService(routeComparisonRepository)
const transitStopDetailsController = new TransitStopDetailsController(transitStopDetailsService)

export const app = express()
app.disable('x-powered-by')
app.set('trust proxy', env.TRUST_PROXY)
app.use(helmet())
app.use(cors(corsOptions))
app.use(requestLogger)
mountSwagger(app)
app.all('/api/auth/*splat', toNodeHandler(auth))
app.use(express.json({ limit: '32kb' }))
app.get('/api/health', healthHandler)
app.use('/api/v1', createRecoveryRoutes(recoveryController))
app.use('/api/v1', createInsightsRoutes(insightsController))
app.use('/api/v1', createProfileRoutes(profileController))
app.use('/api/v1', createRoadReportRoutes(roadReportController))
app.use('/api/v1', createRouteComparisonRoutes(routeComparisonController))
app.use('/api/v1', createTransitStopDetailsRoutes(transitStopDetailsController))
app.use(notFoundHandler)
app.use(errorHandler)
