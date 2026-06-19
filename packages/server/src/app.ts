import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import multipart from '@fastify/multipart'
import { resolve } from 'path'
import { mkdirSync } from 'fs'
import { registerAuthRoutes } from './routes/auth.js'
import { registerRoomRoutes } from './routes/rooms.js'
import { registerFileRoutes } from './routes/files.js'
import { registerTabRoutes } from './routes/tabs.js'
import { registerTabConfigRoutes } from './routes/tab-config.js'
import { registerAgentRoutes } from './routes/agents.js'
import { registerProfileRoutes } from './routes/profiles.js'
import { registerFriendRoutes } from './routes/friends.js'
import { registerDmRoutes } from './routes/dm.js'
import { registerConversationRoutes } from './routes/conversations.js'
import { registerMessageRoutes } from './routes/messages.js'
import { registerInteractionRoutes } from './routes/interactions.js'
import { registerSceneRoutes } from './routes/scenes.js'
import { registerAgentToolRoutes } from './routes/agent-tools.js'
import { registerRoomAnalyticsRoutes } from './routes/room-analytics.js'
import { registerPersonalAnalyticsRoutes } from './routes/personal-analytics.js'
import { registerAgentDreamRoutes } from './routes/agent-dreams.js'
import { registerAgentGrowthRoutes } from './routes/agent-growth.js'
import { registerNotificationRoutes } from './routes/notifications.js'
import { registerModelProfileRoutes } from './routes/model-profiles.js'
import { registerBillingRoutes } from './routes/billing.js'
import { registerBillingRuleRoutes } from './routes/billing-rules.js'
import { registerMarketRoutes } from './routes/market.js'
import { authenticate } from './auth/middleware.js'
import { initDatabase } from './storage/db.js'
import { initWebSocket } from './ws/gateway.js'
import { config } from './config.js'
import { agentDreamSchedulerService } from './services/agent-dream-scheduler.service.js'
import { agentGrowthSchedulerService } from './services/agent-growth-scheduler.service.js'
import { platformModelBootstrapService } from './services/platform-model-bootstrap.service.js'
import { marketPricingBootstrapService } from './services/market-pricing-bootstrap.service.js'
import { billingAggregationSchedulerService } from './services/billing-aggregation-scheduler.service.js'
import { agentService } from './services/agent.service.js'
import { systemAdminService } from './services/system-admin.service.js'

async function buildApp() {
  const app = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname'
        }
      }
    }
  })

  // Register CORS
  await app.register(cors, {
    origin: config.cors.origin === '*' ? true : config.cors.origin,
    credentials: true
  })

  // Initialize database
  initDatabase()

  mkdirSync(resolve(config.upload.dir), { recursive: true })

  // Multipart uploads
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024
    }
  })

  // Ensure system users and platform model provider
  systemAdminService.ensureSystemAdmin()
  platformModelBootstrapService.ensurePlatformUserAndModels()
  marketPricingBootstrapService.ensureDefaultMarketPricing()
  void agentService.ensurePackageWorkspaces()
  agentService.recoverStaleRuns()
  void agentService.recoverInterruptedTaskRuns()

  // Static uploaded files (public)
  await app.register(fastifyStatic, {
    root: resolve(config.upload.dir),
    prefix: '/uploads/'
  })

  // Health check (public)
  app.get('/api/health', async () => {
    return { status: 'ok', timestamp: Date.now() }
  })

  // Protected routes (auth required)
  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0]
    const publicApiPaths = new Set(['/api/health', '/api/auth/register', '/api/auth/login'])
    if (path.startsWith('/api/') && !publicApiPaths.has(path) && !path.startsWith('/api/agent-tools/')) {
      await authenticate(request, reply)
    }
  })

  // Register routes
  await registerAuthRoutes(app)
  await registerRoomRoutes(app)
  await registerFileRoutes(app)
  await registerTabRoutes(app)
  await registerTabConfigRoutes(app)
  await registerAgentRoutes(app)
  await registerFriendRoutes(app)
  await registerProfileRoutes(app)
  await registerDmRoutes(app)
  await registerConversationRoutes(app)
  await registerMessageRoutes(app)
  await registerInteractionRoutes(app)
  await registerSceneRoutes(app)
  await registerRoomAnalyticsRoutes(app)
  await registerPersonalAnalyticsRoutes(app)
  await registerAgentDreamRoutes(app)
  await registerAgentGrowthRoutes(app)
  await registerNotificationRoutes(app)
  await registerModelProfileRoutes(app)
  await registerBillingRoutes(app)
  await registerBillingRuleRoutes(app)
  await registerMarketRoutes(app)
  await registerAgentToolRoutes(app)

  // Error handler
  app.setErrorHandler((error: any, request, reply) => {
    app.log.error(error)
    reply.code(error.statusCode || 500).send({
      success: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Internal server error'
      }
    })
  })

  return app
}

export async function startServer() {
  const app = await buildApp()
  
  const server = await app.listen({
    port: config.port,
    host: config.host
  })

  console.log(`Server running at ${server}`)

  // Initialize WebSocket
  initWebSocket(app.server)

  // Start nightly Agent dream/growth reviews
  agentDreamSchedulerService.start()
  agentGrowthSchedulerService.start()
  billingAggregationSchedulerService.start()

  return app
}
