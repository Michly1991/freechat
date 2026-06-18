import { FastifyInstance } from 'fastify'
import { interactionService } from '../services/interaction.service.js'
import { roomService } from '../services/room.service.js'
import { getGateway } from '../ws/gateway.js'
import { taskService } from '../services/task.service.js'
import { taskItemService } from '../services/task-item.service.js'
import { agentService } from '../services/agent.service.js'
import { messageService } from '../services/message.service.js'
import db from '../storage/db.js'

function broadcast(roomId: string, action: string, payload: any) {
  getGateway()?.broadcast(roomId, {
    msgId: `${action}_${Date.now()}`,
    roomId,
    type: 'broadcast',
    action,
    payload,
    timestamp: Date.now(),
  })
}

async function resolveAgentAssignee(roomId: string, raw: any): Promise<{ assigneeId?: string; assigneeName?: string; assigneeType?: 'agent' }> {
  const text = String(raw || '').trim().replace(/^@/, '')
  if (!text) return {}
  const agents = await agentService.getRoomAgents(roomId)
  const agent = agents.find((a) => a.id === text || a.name === text || a.name.includes(text) || text.includes(a.name))
  if (!agent) throw { code: 'AGENT_ASSIGNEE_NOT_FOUND', message: `Agent assignee not found in room: ${text}` }
  return { assigneeId: agent.id, assigneeName: agent.name, assigneeType: 'agent' }
}

async function invokeAssignedAgent(roomId: string, assigneeId: string | undefined, prompt: string, actorUserId?: string, context: { taskId?: string; subtaskId?: string } = {}) {
  if (!assigneeId) return
  const agents = await agentService.getRoomAgents(roomId)
  const assigned = agents.find((a) => a.id === assigneeId)
  if (!assigned) return
  void (async () => {
    try {
      await agentService.updateAgent(assigned.id, { status: 'working' } as any)
      broadcast(roomId, 'agent.status_update', { agentId: assigned.id, status: 'working', onlineStatus: 'working', lastActiveAt: Date.now() })
      const result = await agentService.spawnClaudeCode(roomId, assigned.id, prompt, { actorUserId, runSource: context.subtaskId ? 'subtask' : 'task', taskId: context.taskId, subtaskId: context.subtaskId })
      await agentService.updateAgent(assigned.id, { status: 'active' } as any)
      broadcast(roomId, 'agent.status_update', { agentId: assigned.id, status: 'active', onlineStatus: 'online', lastActiveAt: Date.now() })
      if (result.silent || !result.response) return
      const msg = await messageService.createMessage(roomId, assigned.id, assigned.name, 'ai', result.response)
      broadcast(roomId, 'chat.message', msg)
    } catch (err: any) {
      await agentService.updateAgent(assigneeId, { status: 'error' } as any).catch(() => {})
      broadcast(roomId, 'agent.status_update', { agentId: assigneeId, status: 'error', onlineStatus: 'error', lastActiveAt: Date.now(), lastError: err?.message || String(err) })
      console.error(`Task-plan assigned agent ${assigneeId} invocation failed:`, err)
    }
  })()
}

function normalizeDependsOn(value: any): number[] {
  if (value === undefined || value === null || value === '') return []
  const values = Array.isArray(value) ? value : [value]
  return values.map((v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 0)
}

function buildSubtaskWakePrompt(task: any, subtask: any, reason: string) {
  return [
    reason,
    `父任务ID: ${task.id}`,
    `父任务标题: ${task.title}`,
    `子任务ID: ${subtask.id}`,
    `子任务标题: ${subtask.title}`,
    subtask.description ? `子任务说明: ${subtask.description}` : '',
    '',
    '请先用 ./freechat task subtask update 标记状态/进展，完成后在聊天中简短汇报。',
  ].filter(Boolean).join('\n')
}

export async function materializeAgentCreateRequest(roomId: string, interaction: any) {
  if (interaction.result?.value !== 'confirm') return
  if (interaction.consumedAt) return
  const spec = interaction.payload?.agentCreate
  if (!spec?.name) return
  const ownerId = interaction.resolvedBy || (db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(roomId) as any)?.created_by || interaction.createdBy
  const created = await agentService.createAgent(ownerId, {
    name: String(spec.name).trim(),
    roleType: spec.roleType === 'assistant' ? 'assistant' : 'specialist',
    deployment: spec.deployment === 'client' ? 'client' : 'server',
    description: spec.description,
    specialties: Array.isArray(spec.specialties) ? spec.specialties : [],
    config: spec.config,
  } as any)
  await agentService.addAgentToRoom(roomId, created.agent.id, ownerId, {
    roomRole: spec.roomRole === 'assistant' ? 'assistant' : 'specialist',
    autoEnabled: spec.autoEnabled === true,
    priority: Number(spec.priority || 0),
  })
  await agentService.refreshRoomAgentContext(roomId)
  const members = await roomService.getRoomMembers(roomId)
  const agents = await agentService.getRoomAgents(roomId)
  broadcast(roomId, 'room.members_update', { members, agents })
  const consumed = interactionService.consume(roomId, interaction.id, interaction.resolvedBy || ownerId)
  broadcast(roomId, 'interaction.updated', { interaction: consumed })
  const msg = await messageService.createMessage(roomId, interaction.createdBy, 'Agent 创建', 'ai', `✅ 已创建并加入专家 Agent：${created.agent.name}`)
  broadcast(roomId, 'chat.message', msg)
}

export async function materializeTaskPlan(roomId: string, interaction: any) {
  if (interaction.type !== 'task_plan') return
  if (interaction.result?.value !== 'confirm') return
  if (interaction.consumedAt) return
  const plan = interaction.payload?.taskPlan
  if (!plan?.title) throw { code: 'VALIDATION_ERROR', message: 'invalid task plan payload' }
  const reusable = plan.reuseTaskId ? await taskService.getTask(plan.reuseTaskId) : await taskService.findReusableTask(roomId, plan.title)
  const task = reusable || await taskService.createTask(roomId, plan.title, plan.description, plan.priority || 'medium', undefined, undefined, undefined, interaction.createdBy)
  broadcast(roomId, 'task.changed', { action: reusable ? 'update' : 'add', task })
  const createdItems: any[] = []
  const wakeQueue: any[] = []
  const planItems = plan.items || []
  for (const [index, item] of planItems.entries()) {
    const existingItem = taskItemService.findReusableItem(task.id, item.title)
    if (existingItem) {
      createdItems.push(existingItem)
      continue
    }
    const resolved = await resolveAgentAssignee(roomId, item.assignee)
    const deps = normalizeDependsOn(item.dependsOn)
    const validDeps = deps.filter((depIndex) => depIndex < index && createdItems[depIndex])
    const blocked = validDeps.length > 0
    const blockedReason = blocked ? `等待前置步骤：${validDeps.map((depIndex) => createdItems[depIndex].title).join('、')}` : undefined
    const subtask = await taskItemService.create(task.id, {
      title: item.title,
      description: [item.description, item.expectedOutput ? `预期产出：${item.expectedOutput}` : '', item.acceptanceCriteria ? `验收标准：${item.acceptanceCriteria}` : ''].filter(Boolean).join('\n'),
      status: blocked ? 'blocked' : undefined,
      blockedReason,
      assigneeId: resolved.assigneeId,
      assigneeName: resolved.assigneeName,
      assigneeType: resolved.assigneeType,
      createdBy: interaction.createdBy,
    })
    for (const depIndex of validDeps) taskItemService.addDependency(subtask.id, createdItems[depIndex].id)
    const hydrated = taskItemService.get(subtask.id)
    createdItems.push(hydrated)
    if (!blocked && resolved.assigneeId) wakeQueue.push({ assigneeId: resolved.assigneeId, subtask: hydrated })
  }
  for (const item of wakeQueue) {
    await invokeAssignedAgent(roomId, item.assigneeId, buildSubtaskWakePrompt(task, item.subtask, '用户已确认任务计划，你被分派了其中一个子任务，请立即处理。'), interaction.resolvedBy || interaction.createdBy, { taskId: task.id, subtaskId: item.subtask.id })
  }
  const updatedTask = await taskService.getTask(task.id)
  broadcast(roomId, 'task.changed', { action: 'update', task: updatedTask })
  const consumed = interactionService.consume(roomId, interaction.id, interaction.resolvedBy || interaction.createdBy)
  broadcast(roomId, 'interaction.updated', { interaction: consumed })
  const createdCount = createdItems.filter((item) => item.createdAt >= interaction.createdAt).length
  const msg = await messageService.createMessage(roomId, interaction.createdBy, '任务计划', 'ai', `✅ 已根据确认${reusable ? '复用/更新' : '创建'}任务：${task.title}\n子任务：${createdItems.length} 个${reusable ? `（新增 ${createdCount} 个）` : ''}`)
  broadcast(roomId, 'chat.message', msg)
}

export async function registerInteractionRoutes(app: FastifyInstance) {
  app.get('/api/rooms/:roomId/interactions', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    const query = request.query as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    const interactions = interactionService.list(roomId, { status: query.status, targetUserId: query.target === 'me' ? user.id : undefined })
    return reply.send({ success: true, data: { interactions } })
  })

  app.post('/api/rooms/:roomId/interactions', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    const body = request.body as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    try {
      const result = await interactionService.create(roomId, { id: user.id, name: user.nickname || user.username, role: 'human' }, body)
      broadcast(roomId, 'chat.message', result.message)
      broadcast(roomId, 'interaction.created', { interaction: result.interaction })
      return reply.send({ success: true, data: result })
    } catch (err: any) {
      return reply.code(400).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.get('/api/rooms/:roomId/interactions/:id', async (request, reply) => {
    const user = (request as any).user
    const { roomId, id } = request.params as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    try {
      return reply.send({ success: true, data: { interaction: interactionService.get(roomId, id) } })
    } catch (err: any) {
      return reply.code(err.code === 'INTERACTION_NOT_FOUND' ? 404 : 400).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.patch('/api/rooms/:roomId/interactions/:id/respond', async (request, reply) => {
    const user = (request as any).user
    const { roomId, id } = request.params as any
    const body = request.body as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    try {
      const interaction = interactionService.respond(roomId, id, user.id, body.value ?? body.values, body.inputs || {})
      broadcast(roomId, 'interaction.updated', { interaction })
      await materializeAgentCreateRequest(roomId, interaction)
      await materializeTaskPlan(roomId, interaction)
      return reply.send({ success: true, data: { interaction } })
    } catch (err: any) {
      const status = err.code === 'INTERACTION_NOT_FOUND' ? 404 : (err.code === 'FORBIDDEN' ? 403 : 400)
      return reply.code(status).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.post('/api/rooms/:roomId/interactions/:id/respond', async (request, reply) => {
    const user = (request as any).user
    const { roomId, id } = request.params as any
    const body = request.body as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    try {
      const interaction = interactionService.respond(roomId, id, user.id, body.value ?? body.values, body.inputs || {})
      broadcast(roomId, 'interaction.updated', { interaction })
      await materializeAgentCreateRequest(roomId, interaction)
      await materializeTaskPlan(roomId, interaction)
      return reply.send({ success: true, data: { interaction } })
    } catch (err: any) {
      const status = err.code === 'INTERACTION_NOT_FOUND' ? 404 : (err.code === 'FORBIDDEN' ? 403 : 400)
      return reply.code(status).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.post('/api/rooms/:roomId/interactions/:id/consume', async (request, reply) => {
    const user = (request as any).user
    const { roomId, id } = request.params as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    try {
      const interaction = interactionService.consume(roomId, id, user.id)
      broadcast(roomId, 'interaction.updated', { interaction })
      return reply.send({ success: true, data: { interaction } })
    } catch (err: any) {
      return reply.code(err.code === 'INTERACTION_NOT_FOUND' ? 404 : 400).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.post('/api/rooms/:roomId/interactions/:id/cancel', async (request, reply) => {
    const user = (request as any).user
    const { roomId, id } = request.params as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    try {
      const interaction = interactionService.cancel(roomId, id, user.id)
      broadcast(roomId, 'interaction.updated', { interaction })
      return reply.send({ success: true, data: { interaction } })
    } catch (err: any) {
      const status = err.code === 'INTERACTION_NOT_FOUND' ? 404 : (err.code === 'FORBIDDEN' ? 403 : 400)
      return reply.code(status).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })
}
