import { FastifyInstance } from 'fastify'
import { registerAgentKnowledgeRoutes } from './agent-knowledge.js'
import { registerAgentCoreRoutes } from './agents/agent-core.routes.js'
import { registerAgentPermissionRoutes } from './agents/agent-permissions.routes.js'
import { registerAgentCapabilityRoutes } from './agents/agent-capabilities.routes.js'
import { registerAgentAdminRoutes } from './agents/agent-admin.routes.js'
import { registerRoomAgentRoutes } from './agents/room-agent.routes.js'
import { registerAgentMarketRoutes } from './agents/agent-market.routes.js'

export async function registerAgentRoutes(app: FastifyInstance) {
  await registerAgentCoreRoutes(app)
  registerAgentKnowledgeRoutes(app)
  await registerAgentPermissionRoutes(app)
  await registerAgentCapabilityRoutes(app)
  await registerAgentAdminRoutes(app)
  await registerRoomAgentRoutes(app)
  await registerAgentMarketRoutes(app)
}
