import { FastifyInstance } from 'fastify'
import { agentService } from '../../services/agent.service.js'

export async function registerAgentAdminRoutes(app: FastifyInstance) {
// DELETE /api/agents/:id - delete agent
app.delete('/api/agents/:id', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any

  try {
    await agentService.assertAgentOwner(id, user.id, user.role)
    await agentService.deleteAgent(id)
    return reply.send({ success: true })
  } catch (err: any) {
    throw err
  }
})

// POST /api/agents/:id/regenerate-key - regenerate api_key
app.post('/api/agents/:id/regenerate-key', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any

  try {
    await agentService.assertAgentOwner(id, user.id, user.role)
    const apiKey = await agentService.regenerateApiKey(id)
    return reply.send({ success: true, data: { apiKey } })
  } catch (err: any) {
    if (err.code === 'AGENT_NOT_FOUND') {
      return reply.code(404).send({ success: false, error: err })
    }
    throw err
  }
})

}
