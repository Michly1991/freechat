import { FastifyInstance } from 'fastify'
import { agentClientBindRequestService } from '../services/agent-client-bind-request.service.js'

function routeError(reply: any, err: any) {
  if (['AGENT_NOT_FOUND', 'BIND_REQUEST_NOT_FOUND', 'CONNECTOR_NOT_FOUND'].includes(err.code)) return reply.code(404).send({ success: false, error: err })
  if (err.code === 'FORBIDDEN') return reply.code(403).send({ success: false, error: err })
  throw err
}

export async function registerAgentClientBindRequestRoutes(app: FastifyInstance) {
  app.get('/api/agent-client/bind-requests', async (request, reply) => {
    const user = (request as any).user
    const query = request.query as any
    try {
      return reply.send({ success: true, data: { requests: agentClientBindRequestService.listPendingForOwner(user.id, query?.instanceId) } })
    } catch (err: any) { return routeError(reply, err) }
  })

  app.post('/api/agent-client/bind-requests/:id/complete', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    try {
      return reply.send({ success: true, data: { request: agentClientBindRequestService.complete(id, user.id, String(body?.connectorId || '')) } })
    } catch (err: any) { return routeError(reply, err) }
  })

  app.post('/api/agent-client/bind-requests/:id/fail', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    try {
      return reply.send({ success: true, data: { request: agentClientBindRequestService.fail(id, user.id, String(body?.error || body?.message || 'bind failed')) } })
    } catch (err: any) { return routeError(reply, err) }
  })
}
