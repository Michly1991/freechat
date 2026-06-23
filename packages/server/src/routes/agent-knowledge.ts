import { FastifyInstance } from 'fastify'
import { agentService } from '../services/agent.service.js'
import { remoteAgentConnectorService } from '../services/remote-agent-connector.service.js'
import { agentKnowledgeService } from '../services/agent-knowledge.service.js'

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
    const agent: any = await agentService.getAgent(id)
    await agentService.assertAgentOwner(id, user.id, user.role)
    const file = agentKnowledgeService.upsert(id, agent.ownerId || user.id, request.body as any, user.id)
    return reply.code(201).send({ success: true, data: { file, knowledge: agentKnowledgeService.list(id, false) } })
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
