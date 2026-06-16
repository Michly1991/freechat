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
import { registerNotificationRoutes } from './routes/notifications.js'
import { authenticate } from './auth/middleware.js'
import { initDatabase } from './storage/db.js'
import { initWebSocket } from './ws/gateway.js'
import { config } from './config.js'
import { agentDreamSchedulerService } from './services/agent-dream-scheduler.service.js'

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
      fileSize: 10 * 1024 * 1024
    }
  })

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
    const url = request.url
    if (url.startsWith('/api/') && !url.startsWith('/api/auth/') && !url.startsWith('/api/agent-tools/') && url !== '/api/health') {
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
  await registerNotificationRoutes(app)
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

  console.log(`✓ Server running at ${server}`)

  // Initialize WebSocket
  initWebSocket(app.server)

  // Start nightly Agent dream review
  agentDreamSchedulerService.start()

  return app
}
