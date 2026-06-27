import { FastifyInstance } from 'fastify'
import { agentService } from '../../services/agent.service.js'
import { marketEngagementService } from '../../services/market-engagement.service.js'
import { agentPackageService } from '../../services/agent-package.service.js'
import { agentCapabilityService } from '../../services/agent-capability.service.js'
import { agentPackageImportService } from '../../services/agent-package-import.service.js'
import { remoteAgentConnectorService } from '../../services/remote-agent-connector.service.js'
import { agentClientBindRequestService } from '../../services/agent-client-bind-request.service.js'

export async function registerAgentCoreRoutes(app: FastifyInstance) {
// ===== User's own agents =====

// GET /api/agents - list user's agents
app.get('/api/agents', async (request, reply) => {
  const user = (request as any).user
  try {
    const agents = await agentService.getUserAgents(user.id)
    const enriched = await Promise.all(agents.map(async (agent: any) => {
      const canEdit = await agentService.canEditAgent(agent.id, user)
      const isOwner = agent.ownerId === user.id
      const isFollowing = marketEngagementService.isFollowing(user.id, 'agent', agent.id)
      const isBuiltInDefault = agent.builtInKey === 'default_assistant'
      const isBuiltInXiaomi = agent.builtInKey === 'xiaomi_assistant'
      const connectorSummary = remoteAgentConnectorService.getConnectorSummary(agent.id)
      const bindSummary = agentClientBindRequestService.summary(agent.id)
      return { ...agent, ...connectorSummary, ...bindSummary, canEdit, canDelete: canEdit && agent.canDelete !== false, isOwner, isFollowing, canUse: isOwner || isFollowing || isBuiltInDefault || isBuiltInXiaomi || canEdit || user.role === 'admin' }
    }))
    return reply.send({ success: true, data: { agents: enriched } })
  } catch (err: any) {
    throw err
  }
})

// POST /api/agents/package/upload - upload npm tgz Agent package and list in marketplace
app.post('/api/agents/package/upload', async (request, reply) => {
  const user = (request as any).user
  const file = await request.file()
  const result = await agentPackageImportService.importFromMultipartFile(user.id, file)
  return reply.send({ success: true, data: result })
})

// POST /api/agents - create agent (returns api_key once)
app.post('/api/agents', async (request, reply) => {
  const user = (request as any).user
  const { name, deployment, description, specialties, config } = request.body as any

  if (!name || !deployment) {
    return reply.code(400).send({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'name and deployment are required' }
    })
  }
  if (!['client'].includes(deployment)) {
    return reply.code(400).send({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'invalid deployment' }
    })
  }

  try {
    const result = await agentService.createAgent(user.id, {
      name,
      roleType: 'specialist',
      deployment,
      description,
      specialties,
      config,
    })
    return reply.code(201).send({ success: true, data: result })
  } catch (err: any) {
    throw err
  }
})

// PATCH /api/agents/:id - update agent
app.patch('/api/agents/:id', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  const body = request.body as any

  try {
    await agentService.assertAgentOwner(id, user.id, user.role)

    const updated = await agentService.updateAgent(id, {
      name: body.name,
      deployment: body.deployment,
      description: body.description,
      specialties: body.specialties,
      config: body.config,
      status: body.status,
      marketListed: body.marketListed,
    })
    let bindRequest = null
    if (body.marketListed === true) bindRequest = agentClientBindRequestService.autoEnsureForListedClientAgent(id, user.id)
    return reply.send({ success: true, data: { agent: updated, bindRequest } })
  } catch (err: any) {
    if (err.code === 'AGENT_NOT_FOUND') {
      return reply.code(404).send({ success: false, error: err })
    }
    throw err
  }
})

// POST /api/agents/:id/client-bind-request - let an online Agent Client auto-claim this Agent
app.post('/api/agents/:id/client-bind-request', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  await agentService.assertAgentOwner(id, user.id, user.role)
  const body = request.body as any
  const requestRow = agentClientBindRequestService.create(id, user.id, body?.preferredInstanceId)
  return reply.code(201).send({ success: true, data: { request: requestRow } })
})

// POST /api/agents/:id/connectors/pairing-code - create short-lived remote connector pairing code
app.post('/api/agents/:id/connectors/pairing-code', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  await agentService.assertAgentOwner(id, user.id, user.role)
  const result = await remoteAgentConnectorService.createPairingCode(id, user.id)
  return reply.send({ success: true, data: result })
})

// GET /api/agents/:id/connectors - list remote connectors for an Agent
app.get('/api/agents/:id/connectors', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  await agentService.assertAgentOwner(id, user.id, user.role)
  return reply.send({ success: true, data: { connectors: remoteAgentConnectorService.listConnectors(id, user.id) } })
})

// DELETE /api/agents/:id/connectors/:connectorId - revoke remote connector
app.delete('/api/agents/:id/connectors/:connectorId', async (request, reply) => {
  const user = (request as any).user
  const { id, connectorId } = request.params as any
  await agentService.assertAgentOwner(id, user.id, user.role)
  remoteAgentConnectorService.revokeConnector(id, user.id, connectorId)
  return reply.send({ success: true })
})

// GET /api/agents/:id/detail - template/project agent detail with skills and scripts
app.get('/api/agents/:id/detail', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  try {
    const agent: any = await agentService.getAgent(id)
    agent.canEdit = await agentService.canEditAgent(id, user)
    agent.canDelete = agent.canEdit && agent.canDelete !== false
    const skills = agentCapabilityService.listSkills(id)
    const scripts = agentCapabilityService.listScripts(id)
    const agentMarkdown = await agentPackageService.readAgentMarkdown(agent).catch(() => '')
    const connectorSummary = remoteAgentConnectorService.getConnectorSummary(id)
    const bindSummary = agentClientBindRequestService.summary(id)
    return reply.send({ success: true, data: { agent: { ...agent, ...connectorSummary, ...bindSummary, agentMarkdown }, skills, scripts } })
  } catch (err: any) {
    throw err
  }
})

}
