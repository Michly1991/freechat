import { FastifyInstance } from 'fastify'
import { agentService } from '../../services/agent.service.js'

export async function registerAgentMarketRoutes(app: FastifyInstance) {
// ===== Marketplace =====

// GET /api/agent-market/search - search marketplace
app.get('/api/agent-market/search', async (request, reply) => {
  const { q } = request.query as any

  try {
    const agents = await agentService.searchMarketplace(q)
    return reply.send({ success: true, data: { agents } })
  } catch (err: any) {
    throw err
  }
})

// GET /api/agent-market/featured - featured agents
app.get('/api/agent-market/featured', async (request, reply) => {
  try {
    const agents = await agentService.getFeaturedAgents()
    return reply.send({ success: true, data: { agents } })
  } catch (err: any) {
    throw err
  }
})
}
