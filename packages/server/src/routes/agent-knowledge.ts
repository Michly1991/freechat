import { FastifyInstance } from 'fastify'
import { agentService } from '../services/agent.service.js'
import { remoteAgentConnectorService } from '../services/remote-agent-connector.service.js'
import { agentKnowledgeService } from '../services/agent-knowledge.service.js'

function errorStatus(code?: string) {
  if (code === 'VALIDATION_ERROR') return 400
  if (code === 'FORBIDDEN') return 403
  if (code === 'AGENT_NOT_FOUND' || code === 'KNOWLEDGE_FILE_NOT_FOUND') return 404
  return 500
}

function sendKnowledgeError(reply: any, err: any) {
  return reply.code(errorStatus(err?.code)).send({ success: false, error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || String(err) } })
}

export function registerAgentKnowledgeRoutes(app: FastifyInstance) {
  app.get('/api/agents/:id/knowledge', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    await agentService.getAgent(id)
    const canEdit = await agentService.canEditAgent(id, user)
    const canUse = await agentService.canUseAgent(id, user.id)
    if (!canUse && !canEdit && user.role !== 'admin') return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'No permission to read this Agent knowledge base' } })
    const summary = remoteAgentConnectorService.getConnectorSummary(id)
    return reply.send({ success: true, data: { ...agentKnowledgeService.list(id, false), canEdit, managedByClient: !!summary.managedByClient, client: summary.managedByClient ? { connectorId: summary.clientConnectorId, name: summary.clientConnectorName, status: summary.clientConnectorStatus, lastSeenAt: summary.clientLastSeenAt } : null } })
  })

  app.get('/api/agents/:id/knowledge/files/:fileId', async (request, reply) => {
    const user = (request as any).user
    const { id, fileId } = request.params as any
    const canEdit = await agentService.canEditAgent(id, user)
    const canUse = await agentService.canUseAgent(id, user.id)
    if (!canUse && !canEdit && user.role !== 'admin') return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'No permission to read this Agent knowledge file' } })
    return reply.send({ success: true, data: { file: agentKnowledgeService.get(id, fileId), canEdit } })
  })

  app.post('/api/agents/:id/knowledge/files', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try {
      const agent: any = await agentService.getAgent(id)
      await agentService.assertAgentOwner(id, user.id, user.role)
      const file = agentKnowledgeService.upsert(id, agent.ownerId || user.id, request.body as any, user.id)
      return reply.code(201).send({ success: true, data: { file, knowledge: agentKnowledgeService.list(id, false) } })
    } catch (err: any) { return sendKnowledgeError(reply, err) }
  })

  app.post('/api/agents/:id/knowledge/files/upload', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try {
      const agent: any = await agentService.getAgent(id)
      await agentService.assertAgentOwner(id, user.id, user.role)
      const parts = request.parts()
      let uploaded: { filename: string; mimeType?: string; buffer: Buffer } | null = null
      let targetPath = ''
      for await (const part of parts) {
        if (part.type === 'file') {
          if (uploaded) throw { code: 'VALIDATION_ERROR', message: '一次只能上传一个知识文件' }
          uploaded = { filename: part.filename, mimeType: part.mimetype, buffer: await part.toBuffer() }
        } else if (part.fieldname === 'path') {
          targetPath = String(part.value || '').trim()
        }
      }
      if (!uploaded) throw { code: 'VALIDATION_ERROR', message: 'No file uploaded' }
      const file = await agentKnowledgeService.upsertUpload(id, agent.ownerId || user.id, { ...uploaded, path: targetPath || uploaded.filename }, user.id)
      return reply.code(201).send({ success: true, data: { file, knowledge: agentKnowledgeService.list(id, false) } })
    } catch (err: any) { return sendKnowledgeError(reply, err) }
  })

  app.patch('/api/agents/:id/knowledge/files/:fileId', async (request, reply) => {
    const user = (request as any).user
    const { id, fileId } = request.params as any
    await agentService.assertAgentOwner(id, user.id, user.role)
    const file = agentKnowledgeService.update(id, fileId, request.body as any, user.id)
    return reply.send({ success: true, data: { file, knowledge: agentKnowledgeService.list(id, false) } })
  })

  app.delete('/api/agents/:id/knowledge/files/:fileId', async (request, reply) => {
    const user = (request as any).user
    const { id, fileId } = request.params as any
    await agentService.assertAgentOwner(id, user.id, user.role)
    agentKnowledgeService.delete(id, fileId, user.id)
    return reply.send({ success: true, data: { knowledge: agentKnowledgeService.list(id, false) } })
  })

  app.post('/api/agents/:id/knowledge/reindex', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    await agentService.assertAgentOwner(id, user.id, user.role)
    return reply.send({ success: true, data: agentKnowledgeService.reindex(id) })
  })

}
