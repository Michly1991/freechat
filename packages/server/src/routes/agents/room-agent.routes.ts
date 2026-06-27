import { FastifyInstance } from 'fastify'
import { agentService } from '../../services/agent.service.js'
import { roomService } from '../../services/room.service.js'
import { messageService } from '../../services/message.service.js'
import { agentRestartService } from '../../services/agent-restart.service.js'
import { getGateway } from '../../ws/gateway.js'
import { canCommandRoomAgent, isRoomCreator } from './agent-route-helpers.js'

export async function registerRoomAgentRoutes(app: FastifyInstance) {
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
    const room = await roomService.getRoom(roomId) as any
    const isDirectRoom = room.roomKind === 'direct_user' || room.roomKind === 'direct_agent'
    if (isDirectRoom) {
      if (!canCommandRoomAgent(roomId, user.id)) {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only project owner/editor can add agents' } })
      }
      if (!await agentService.canUseAgent(agentId, user.id)) {
        return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: '请先在市场关注/购买该 Agent，或选择自己创建的 Agent' } })
      }
      const members = await roomService.getRoomMembers(roomId)
      const roomAgents = await agentService.getRoomAgents(roomId)
      const target = await agentService.getAgent(agentId)
      const name = `${room.name || '私聊'}、${target.name}`
      const clone = await roomService.createRoom(name, `由私聊「${room.name}」添加 Agent 后新建的群聊；原私聊保持不变。`, user.id, members.map((m: any) => m.userId).filter((id: string) => id !== user.id), [], {
        skipDefaultAssistant: true,
        roomKind: 'group',
        workgroupId: room.workgroupId,
        sourceRoomId: roomId,
        syncInitialMembersToWorkgroup: false,
      } as any)
      for (const existing of roomAgents) {
        await agentService.addAgentToRoom(clone.id, existing.sourceTemplateId || existing.id, user.id, {
          roomRole: existing.roomRole === 'assistant' ? 'assistant' : 'specialist',
          autoEnabled: existing.autoEnabled === true,
          priority: Number(existing.roomPriority || 0),
        }).catch(async () => {
          await agentService.addAgentToRoom(clone.id, existing.id, user.id, {
            roomRole: existing.roomRole === 'assistant' ? 'assistant' : 'specialist',
            autoEnabled: existing.autoEnabled === true,
            priority: Number(existing.roomPriority || 0),
          })
        })
      }
      await agentService.addAgentToRoom(clone.id, agentId, user.id, {
        roomRole: roomRole === 'assistant' ? 'assistant' : 'specialist',
        autoEnabled: autoEnabled === true,
        priority: Number(priority || roomAgents.length + 1),
        confirmedPurchase: confirmedPurchase === true,
      })
      await agentService.refreshRoomAgentContext(clone.id).catch(() => {})
      return reply.send({ success: true, data: { room: await roomService.getRoom(clone.id), agent: target, createdRoom: true, sourceRoom: room } })
    }

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
    const agent = await agentService.updateRoomAgentModelConfig(roomId, agentId, request.body as any, user.id)
    return reply.send({ success: true, data: { agent } })
  } catch (err: any) {
    if (err.code === 'AGENT_NOT_FOUND' || err.code === 'MODEL_PROFILE_NOT_FOUND') return reply.code(404).send({ success: false, error: err })
    if (err.code === 'FORBIDDEN') return reply.code(403).send({ success: false, error: err })
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

}
