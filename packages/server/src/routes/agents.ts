import { FastifyInstance } from 'fastify'
import { agentService } from '../services/agent.service.js'
import { roomService } from '../services/room.service.js'
import { messageService } from '../services/message.service.js'
import { agentCapabilityService } from '../services/agent-capability.service.js'
import { templatePermissionService } from '../services/template-permission.service.js'
import { agentRestartService } from '../services/agent-restart.service.js'
import { getGateway } from '../ws/gateway.js'
import { marketEngagementService } from '../services/market-engagement.service.js'
import { agentPackageService } from '../services/agent-package.service.js'
import db from '../storage/db.js'
import { agentPackageImportService } from '../services/agent-package-import.service.js'
import { remoteAgentConnectorService } from '../services/remote-agent-connector.service.js'
import { registerAgentKnowledgeRoutes } from './agent-knowledge.js'
import { agentClientBindRequestService } from '../services/agent-client-bind-request.service.js'

export async function registerAgentRoutes(app: FastifyInstance) {
  const isRoomCreator = (roomId: string, userId: string) => {
    const row = db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(roomId) as any
    return !!row?.created_by && row.created_by === userId
  }
  const canCommandRoomAgent = (roomId: string, userId: string) => {
    const row = db.prepare('SELECT created_by, workgroup_id FROM rooms WHERE id = ?').get(roomId) as any
    if (!row) return false
    if (row.created_by === userId) return true
    const member = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId) as any
    if (member && ['owner', 'editor'].includes(member.role)) return true
    if (row.workgroup_id) {
      const wgMember = db.prepare('SELECT role FROM workgroup_members WHERE workgroup_id = ? AND user_id = ?').get(row.workgroup_id, userId) as any
      if (wgMember && ['owner', 'admin'].includes(wgMember.role)) return true
    }
    return false
  }

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

  registerAgentKnowledgeRoutes(app)

  app.get('/api/agents/:id/permissions', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    await agentService.getAgent(id)
    const canManage = !agentService.isLockedBuiltInAgent(id) && templatePermissionService.canManage('agent', id, user)
    const members = canManage ? templatePermissionService.listMembers('agent', id) : []
    const requests = canManage ? templatePermissionService.listRequestsForTarget('agent', id) : []
    return reply.send({ success: true, data: { canManage, members, requests } })
  })

  app.post('/api/agents/:id/permissions', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    if (!String(body?.userId || '').trim()) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'userId is required' } })
    agentService.assertAgentMutable(id)
    const members = templatePermissionService.grant('agent', id, user, String(body.userId), body.role || 'editor')
    return reply.send({ success: true, data: { members } })
  })

  app.delete('/api/agents/:id/permissions/:userId', async (request, reply) => {
    const user = (request as any).user
    const { id, userId } = request.params as any
    agentService.assertAgentMutable(id)
    const members = templatePermissionService.revoke('agent', id, user, userId)
    return reply.send({ success: true, data: { members } })
  })

  app.post('/api/agents/:id/permission-requests', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    agentService.assertAgentMutable(id)
    const requestRow = templatePermissionService.request('agent', id, user.id, body?.message, body?.role || 'editor')
    return reply.code(201).send({ success: true, data: { request: requestRow } })
  })

  app.post('/api/agents/:id/permission-requests/:requestId/resolve', async (request, reply) => {
    const user = (request as any).user
    const { requestId } = request.params as any
    const body = request.body as any
    const decision = body?.decision === 'reject' ? 'reject' : 'approve'
    const requestRow = templatePermissionService.resolveRequest(requestId, user, decision)
    return reply.send({ success: true, data: { request: requestRow } })
  })

  app.get('/api/agents/:id/skills', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    await agentService.getAgent(id)
    return reply.send({ success: true, data: { skills: agentCapabilityService.listSkills(id) } })
  })

  app.post('/api/agents/:id/skills', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    if (!String(body?.name || '').trim()) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } })
    await agentService.assertAgentOwner(id, user.id, user.role)
    const skill = agentCapabilityService.createSkill(id, { ...body, name: String(body.name).trim() })
    await agentPackageService.writeSkillPackage(id, skill).catch((err) => console.error('[agent-package] write skill failed', err))
    return reply.code(201).send({ success: true, data: { skill } })
  })

  app.patch('/api/agents/:id/skills/:skillId', async (request, reply) => {
    const user = (request as any).user
    const { id, skillId } = request.params as any
    await agentService.assertAgentOwner(id, user.id, user.role)
    const skill = agentCapabilityService.updateSkill(id, skillId, request.body as any)
    await agentPackageService.writeSkillPackage(id, skill).catch((err) => console.error('[agent-package] update skill package failed', err))
    return reply.send({ success: true, data: { skill } })
  })

  app.delete('/api/agents/:id/skills/:skillId', async (request, reply) => {
    const user = (request as any).user
    const { id, skillId } = request.params as any
    await agentService.assertAgentOwner(id, user.id, user.role)
    const skill = agentCapabilityService.listSkills(id).find((item) => item.id === skillId)
    agentCapabilityService.deleteSkill(id, skillId)
    await agentPackageService.deleteSkillPackage(id, skill).catch(() => {})
    return reply.send({ success: true })
  })

  app.get('/api/agents/:id/scripts', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    await agentService.getAgent(id)
    return reply.send({ success: true, data: { scripts: agentCapabilityService.listScripts(id) } })
  })

  app.post('/api/agents/:id/scripts', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    if (!String(body?.name || '').trim()) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } })
    await agentService.assertAgentOwner(id, user.id, user.role)
    const script = agentCapabilityService.createScript(id, { ...body, name: String(body.name).trim() })
    await agentPackageService.ensureAgentPackage(await agentService.getAgent(id)).catch((err) => console.error('[agent-package] write script failed', err))
    return reply.code(201).send({ success: true, data: { script } })
  })

  app.patch('/api/agents/:id/scripts/:scriptId', async (request, reply) => {
    const user = (request as any).user
    const { id, scriptId } = request.params as any
    await agentService.assertAgentOwner(id, user.id, user.role)
    const script = agentCapabilityService.updateScript(id, scriptId, request.body as any)
    await agentPackageService.ensureAgentPackage(await agentService.getAgent(id)).catch((err) => console.error('[agent-package] update script package failed', err))
    return reply.send({ success: true, data: { script } })
  })

  app.delete('/api/agents/:id/scripts/:scriptId', async (request, reply) => {
    const user = (request as any).user
    const { id, scriptId } = request.params as any
    await agentService.assertAgentOwner(id, user.id, user.role)
    agentCapabilityService.deleteScript(id, scriptId)
    await agentPackageService.ensureAgentPackage(await agentService.getAgent(id)).catch(() => {})
    return reply.send({ success: true })
  })

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

  // ===== Room agents =====

  // GET /api/rooms/:roomId/agents - list room agents
  app.get('/api/rooms/:roomId/agents', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any

    try {
      const isMember = await roomService.isMember(roomId, user.id)
      if (!isMember) {
        return reply.code(403).send({
          success: false,
          error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' }
        })
      }

      const agents = await agentService.getRoomAgents(roomId)
      return reply.send({ success: true, data: { agents } })
    } catch (err: any) {
      throw err
    }
  })

  // POST /api/rooms/:roomId/agents - add agent to room
  app.post('/api/rooms/:roomId/agents', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    const { agentId, roomRole, autoEnabled, priority, confirmedPurchase } = request.body as any

    if (!agentId) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'agentId is required' }
      })
    }

    try {
      const canEdit = await agentService.canEditRoomAgents(roomId, user.id)
      if (!canEdit) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only project owner/editor can add agents' }
        })
      }

      if (!await agentService.canUseAgent(agentId, user.id)) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: '请先在市场关注/购买该 Agent，或选择自己创建的 Agent' }
        })
      }

      await agentService.addAgentToRoom(roomId, agentId, user.id, {
        roomRole: roomRole === 'assistant' ? 'assistant' : 'specialist',
        autoEnabled: autoEnabled === true,
        priority: Number(priority || 0),
        confirmedPurchase: confirmedPurchase === true,
      })

      // Refresh Agent-visible room context files
      await agentService.refreshRoomAgentContext(roomId)

      const agent = await agentService.getAgent(agentId)
      return reply.send({ success: true, data: { agent } })
    } catch (err: any) {
      if (err.code === 'AGENT_NOT_FOUND') {
        return reply.code(404).send({ success: false, error: err })
      }
      if (err.code === 'PURCHASE_CONFIRMATION_REQUIRED') {
        return reply.code(409).send({ success: false, error: { code: err.code, message: err.message, priceCredits: err.priceCredits } })
      }
      if (err.code === 'INSUFFICIENT_CREDITS') {
        return reply.code(402).send({ success: false, error: { code: err.code, message: err.message } })
      }
      if (err.code === 'AGENT_NOT_FOLLOWED') {
        return reply.code(403).send({ success: false, error: { code: err.code, message: err.message } })
      }
      throw err
    }
  })

  // PATCH /api/rooms/:roomId/agents/:agentId/model - update room-agent model config
  app.patch('/api/rooms/:roomId/agents/:agentId/model', async (request, reply) => {
    const user = (request as any).user
    const { roomId, agentId } = request.params as any
    try {
      const canEdit = await agentService.canEditRoomAgents(roomId, user.id)
      if (!canEdit) {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only project owner/editor can configure room agents' } })
      }
      const agent = await agentService.updateRoomAgentModelConfig(roomId, agentId, request.body as any)
      return reply.send({ success: true, data: { agent } })
    } catch (err: any) {
      if (err.code === 'AGENT_NOT_FOUND' || err.code === 'MODEL_PROFILE_NOT_FOUND') return reply.code(404).send({ success: false, error: err })
      throw err
    }
  })

  // DELETE /api/rooms/:roomId/agents/:agentId - remove agent from room
  app.delete('/api/rooms/:roomId/agents/:agentId', async (request, reply) => {
    const user = (request as any).user
    const { roomId, agentId } = request.params as any

    try {
      const canEdit = await agentService.canEditRoomAgents(roomId, user.id)
      if (!canEdit) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only project owner/editor can remove agents' }
        })
      }

      await agentService.removeAgentFromRoom(roomId, agentId)

      // Refresh Agent-visible room context files
      await agentService.refreshRoomAgentContext(roomId)

      return reply.send({ success: true })
    } catch (err: any) {
      throw err
    }
  })

  // POST /api/rooms/:roomId/agents/:agentId/restart - soft restart room agent
  app.post('/api/rooms/:roomId/agents/:agentId/restart', async (request, reply) => {
    const user = (request as any).user
    const { roomId, agentId } = request.params as any
    const { clearSession = true, mode = 'soft' } = request.body as any || {}

    if (!canCommandRoomAgent(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'ROOM_AGENT_COMMAND_FORBIDDEN', message: '只有房间 owner/editor 或工作组 owner/admin 可以重启 Agent；如产生模型费用，由项目承担。' } })
    }

    const result = await agentRestartService.restart(roomId, agentId, user.id, { mode: mode === 'force' ? 'force' : 'soft', clearSession: clearSession !== false })
    const gateway = getGateway()
    gateway?.broadcast(roomId, {
      msgId: `agent_restart_${Date.now()}`,
      roomId,
      type: 'broadcast',
      action: 'agent.status_update',
      payload: { agentId: result.agent.id, status: result.agent.status, onlineStatus: 'online', lastActiveAt: Date.now(), lastError: null },
      timestamp: Date.now()
    })
    if (result.pendingSubtasks.length > 0) {
      const lines = result.pendingSubtasks.map((item: any, i: number) => `${i + 1}. 父任务 ${item.task_id}「${item.task_title}」 / 子任务 ${item.id}「${item.title}」`).join('\n')
      void gateway?.invokeAgents(roomId, `你刚刚被人工${result.mode === 'force' ? '强制重启' : '软恢复'}，请继续处理已分派但未完成的子任务：\n${lines}\n\n请先用 ./freechat task subtask update 标记状态/进展，完成后在聊天中简短汇报。`, [{ id: result.agent.id, name: result.agent.name, role: 'ai' }], 'task', user.id)
    }
    return reply.send({ success: true, data: result })
  })

  // POST /api/rooms/:roomId/agents/:agentId/invoke - invoke agent with a message
  app.post('/api/rooms/:roomId/agents/:agentId/invoke', async (request, reply) => {
    const user = (request as any).user
    const { roomId, agentId } = request.params as any
    const { message } = request.body as any

    if (!message) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'message is required' }
      })
    }

    try {
      const isMember = await roomService.isMember(roomId, user.id)
      if (!isMember) {
        return reply.code(403).send({
          success: false,
          error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' }
        })
      }
      if (!isRoomCreator(roomId, user.id)) {
        return reply.code(403).send({ success: false, error: { code: 'CREATOR_ONLY_AGENT_COMMAND', message: '只有项目创建人可以指挥 Agent；如产生模型费用，由项目创建人承担。' } })
      }

      // Mark agent as working
      await agentService.updateAgent(agentId, { status: 'working' } as any)

      try {
        const result = await agentService.enqueueAgentRun(roomId, agentId, message, { actorUserId: user.id })

        // Mark agent as active again
        await agentService.updateAgent(agentId, { status: 'active' } as any)

        if (result.silent) {
          return reply.send({ success: true, data: { response: '', silent: true } })
        }

        // Post agent response as a message in the room
        if (result.response) {
          const agent = await agentService.getAgent(agentId)
          const msg = await messageService.createMessage(
            roomId,
            agentId,
            agent.name,
            'ai',
            result.response
          )
          return reply.send({ success: true, data: { response: result.response, message: msg } })
        }

        return reply.send({ success: true, data: { response: result.response } })
      } catch (execErr: any) {
        const isBillingBlock = execErr?.code === 'INSUFFICIENT_CREDITS'
        await agentService.updateAgent(agentId, { status: isBillingBlock ? 'active' : 'error' } as any)
        if (isBillingBlock) {
          return reply.code(402).send({ success: false, error: { code: execErr.code, message: execErr.message, details: execErr.details } })
        }
        throw execErr
      }
    } catch (err: any) {
      if (err.code === 'AGENT_NOT_FOUND') {
        return reply.code(404).send({ success: false, error: err })
      }
      throw err
    }
  })

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
