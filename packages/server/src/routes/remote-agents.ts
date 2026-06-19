import { FastifyInstance } from 'fastify'
import { remoteAgentConnectorService } from '../services/remote-agent-connector.service.js'

async function requireConnector(request: any, reply: any) {
  const auth = await remoteAgentConnectorService.authenticateBearer(request.headers.authorization)
  if (!auth) {
    reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid remote Agent connector credential' } })
    return null
  }
  return auth
}

export async function registerRemoteAgentRoutes(app: FastifyInstance) {
  app.post('/api/remote-agents/register', async (request, reply) => {
    const body = request.body as any
    const result = await remoteAgentConnectorService.register({
      pairingCode: body?.pairingCode,
      instanceId: body?.instanceId,
      name: body?.name,
      clientVersion: body?.clientVersion,
      capabilities: body?.capabilities,
    })
    return { success: true, data: result }
  })

  app.post('/api/remote-agents/heartbeat', async (request, reply) => {
    const auth = await requireConnector(request, reply)
    if (!auth) return
    return { success: true, data: remoteAgentConnectorService.heartbeat(auth, request.body || {}) }
  })

  app.get('/api/remote-agents/events', async (request, reply) => {
    const auth = await requireConnector(request, reply)
    if (!auth) return
    const query = request.query as any
    return { success: true, data: { events: remoteAgentConnectorService.pollEvents(auth, Number(query?.limit || 10)) } }
  })

  app.post('/api/remote-agents/runs/:runId/activity', async (request, reply) => {
    const auth = await requireConnector(request, reply)
    if (!auth) return
    const { runId } = request.params as any
    const body = request.body as any
    return { success: true, data: remoteAgentConnectorService.activity(auth, runId, String(body?.text || body?.message || 'working')) }
  })

  app.post('/api/remote-agents/runs/:runId/complete', async (request, reply) => {
    const auth = await requireConnector(request, reply)
    if (!auth) return
    const { runId } = request.params as any
    return { success: true, data: remoteAgentConnectorService.complete(auth, runId, request.body || {}) }
  })

  app.post('/api/remote-agents/runs/:runId/fail', async (request, reply) => {
    const auth = await requireConnector(request, reply)
    if (!auth) return
    const { runId } = request.params as any
    const body = request.body as any
    return { success: true, data: remoteAgentConnectorService.fail(auth, runId, String(body?.error || body?.message || 'Remote Agent failed')) }
  })
}
