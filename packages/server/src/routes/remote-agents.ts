import { FastifyInstance } from 'fastify'
import { remoteAgentConnectorService } from '../services/remote-agent-connector.service.js'
import { agentRuntimeSpecService } from '../services/agent-runtime-spec.service.js'
import { agentKnowledgeService } from '../services/agent-knowledge.service.js'

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
    const agentIds = typeof query?.agentIds === 'string' ? query.agentIds.split(',').filter(Boolean) : undefined
    return { success: true, data: { events: remoteAgentConnectorService.pollEvents(auth, Number(query?.limit || 10), agentIds) } }
  })

  app.get('/api/remote-agents/runtime-spec', async (request, reply) => {
    const auth = await requireConnector(request, reply)
    if (!auth) return
    return { success: true, data: agentRuntimeSpecService.getSpec() }
  })

  app.get('/api/remote-agents/knowledge', async (request, reply) => {
    const auth = await requireConnector(request, reply)
    if (!auth) return
    return { success: true, data: agentKnowledgeService.list(auth.agentId, false) }
  })

  app.get('/api/remote-agents/knowledge/search', async (request, reply) => {
    const auth = await requireConnector(request, reply)
    if (!auth) return
    const query = request.query as any
    try {
      return { success: true, data: agentKnowledgeService.search(auth.agentId, String(query?.q || query?.query || ''), { limit: Number(query?.limit || 8), includePublic: query?.includePublic !== 'false' }) }
    } catch (err: any) {
      return reply.code(err?.code === 'VALIDATION_ERROR' ? 400 : 500).send({ success: false, error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || String(err) } })
    }
  })

  app.get('/api/remote-agents/knowledge/read', async (request, reply) => {
    const auth = await requireConnector(request, reply)
    if (!auth) return
    const query = request.query as any
    try {
      return { success: true, data: agentKnowledgeService.read(auth.agentId, String(query?.ref || query?.path || query?.fileId || '')) }
    } catch (err: any) {
      const status = err?.code === 'VALIDATION_ERROR' ? 400 : err?.code === 'KNOWLEDGE_FILE_NOT_FOUND' ? 404 : 500
      return reply.code(status).send({ success: false, error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || String(err) } })
    }
  })


  app.get('/api/remote-agents/events/stream', async (request, reply) => {
    const auth = await requireConnector(request, reply)
    if (!auth) return
    const raw = reply.raw
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const send = (event: any) => raw.write(`event: remote-event\ndata: ${JSON.stringify(event)}\n\n`)
    raw.write(`event: ready\ndata: ${JSON.stringify({ ok: true, agentId: auth.agentId })}\n\n`)
    const unsubscribe = remoteAgentConnectorService.subscribe(auth, send)
    const ping = setInterval(() => raw.write(`event: ping\ndata: ${JSON.stringify({ now: Date.now() })}\n\n`), 25000)
    request.raw.on('close', () => { clearInterval(ping); unsubscribe() })
    return reply
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
