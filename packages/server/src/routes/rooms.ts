import { FastifyInstance } from 'fastify'
import { roomService } from '../services/room.service.js'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { getGateway } from '../ws/gateway.js'
import { areFriends } from './friends.js'
import { agentService } from '../services/agent.service.js'
import { taskService } from '../services/task.service.js'
import { taskItemService } from '../services/task-item.service.js'
import { taskRetryService } from '../services/task-retry.service.js'
import { notificationService } from '../services/notification.service.js'
import { sceneTemplateService } from '../services/scene-template.service.js'
import { marketEngagementService } from '../services/market-engagement.service.js'
import { creditWalletService } from '../services/credit-wallet.service.js'

export async function registerRoomRoutes(app: FastifyInstance) {
  // Get user's rooms
  app.get('/api/rooms', async (request, reply) => {
    const user = (request as any).user
    try {
      const rooms = await roomService.getUserRooms(user.id)
      return reply.send({ success: true, data: { rooms } })
    } catch (err: any) {
      throw err
    }
  })

  // Create room
  app.post('/api/rooms', async (request, reply) => {
    const user = (request as any).user
    const { name, description, memberIds, agents, sceneId } = request.body as any

    if (!name) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Room name is required' }
      })
    }

    try {
      const account = creditWalletService.getAccount(user.id)
      if (account.balance <= 0) {
        return reply.code(402).send({ success: false, error: { code: 'INSUFFICIENT_CREDITS', message: '余额不足，不能创建项目。请先充值 credit。' } })
      }
      const initialMemberIds = Array.isArray(memberIds)
        ? memberIds.filter((id: string) => id && id !== user.id && areFriends(user.id, id))
        : []
      // When a scene is selected, scene application is the single source of default Agents/pages.
      // Ignore client-selected agents to avoid cloning scene Agents twice from stale/cached clients.
      const initialAgents = sceneId ? [] : (Array.isArray(agents) ? agents : [])
      if (sceneId) sceneTemplateService.ensureBuiltInScenes(user.id)
      if (sceneId && !marketEngagementService.canUseScene(user, String(sceneId))) return reply.code(403).send({ success: false, error: { code: 'SCENE_NOT_PURCHASED', message: '请先购买或选择已拥有的场景' } })
      const sceneProvidesAssistant = sceneId ? sceneTemplateService.sceneHasAssistant(String(sceneId)) : false
      const room = await roomService.createRoom(name, description || null, user.id, initialMemberIds, [], { skipDefaultAssistant: sceneProvidesAssistant })
      try {
        if (sceneId) await sceneTemplateService.applySceneToRoom(String(sceneId), room.id, user.id)
        if (!sceneId) {
          for (const agent of initialAgents) {
            if (!agent?.agentId) continue
            await agentService.addAgentToRoom(room.id, String(agent.agentId), user.id, {
              roomRole: agent.roomRole === 'assistant' ? 'assistant' : 'specialist',
              autoEnabled: agent.autoEnabled === true,
              priority: Number(agent.priority || 0),
              confirmedPurchase: agent.confirmedPurchase === true,
            })
          }
        }
        await agentService.refreshRoomAgentContext(room.id).catch(() => {})
        return reply.send({ success: true, data: { room } })
      } catch (err) {
        await roomService.deleteRoom(room.id, user.id).catch(() => {})
        throw err
      }
    } catch (err: any) {
      if (err.code === 'PURCHASE_CONFIRMATION_REQUIRED') return reply.code(409).send({ success: false, error: { code: err.code, message: err.message, priceCredits: err.priceCredits } })
      if (err.code === 'INSUFFICIENT_CREDITS') return reply.code(402).send({ success: false, error: { code: err.code, message: err.message } })
      throw err
    }
  })

  // Get room details
  app.get('/api/rooms/:id', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any

    try {
      const isMember = await roomService.isMember(id, user.id)
      if (!isMember) {
        return reply.code(403).send({
          success: false,
          error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' }
        })
      }

      const room = await roomService.getRoom(id)
      const members = await roomService.getRoomMembers(id)
      return reply.send({ success: true, data: { room, members } })
    } catch (err: any) {
      if (err.code === 'ROOM_NOT_FOUND') {
        return reply.code(404).send({ success: false, error: err })
      }
      throw err
    }
  })

  // Update room
  app.patch('/api/rooms/:id', async (request, reply) => {
    const { id } = request.params as any
    const { name, description } = request.body as any

    try {
      const room = await roomService.updateRoom(id, name, description)
      return reply.send({ success: true, data: { room } })
    } catch (err: any) {
      throw err
    }
  })

  // Delete room
  app.delete('/api/rooms/:id', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any

    try {
      await roomService.deleteRoom(id, user.id)
      return reply.send({ success: true })
    } catch (err: any) {
      if (err.code === 'ROOM_NOT_FOUND') {
        return reply.code(404).send({ success: false, error: err })
      }
      if (err.code === 'FORBIDDEN') {
        return reply.code(403).send({ success: false, error: err })
      }
      throw err
    }
  })

  // Get room tasks
  app.get('/api/rooms/:id/tasks', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const { status } = request.query as any

    const isMember = await roomService.isMember(id, user.id)
    if (!isMember) {
      return reply.code(403).send({
        success: false,
        error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' }
      })
    }

    const tasks = await taskService.getRoomTasks(id, status)
    return reply.send({ success: true, data: { tasks } })
  })

  // Create task via REST (WS parity)
  app.post('/api/rooms/:id/tasks', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    const isMember = await roomService.isMember(id, user.id)
    if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    const task = await taskService.createTask(id, body.title, body.description, body.priority, body.assigneeId || body.assignee_id, body.assigneeName || body.assignee_name, body.assigneeType || body.assignee_type, user.id)
    notificationService.notifyTaskAssigned({ roomId: id, taskId: task.id, title: task.title, assigneeId: task.assigneeId, assigneeType: task.assigneeType, actorId: user.id, actorName: user.nickname || user.username })
    getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'add', task }, timestamp: Date.now() })
    return reply.code(201).send({ success: true, data: { task } })
  })

  // Update task via REST (WS parity)
  app.patch('/api/rooms/:id/tasks/:taskId', async (request, reply) => {
    const user = (request as any).user
    const { id, taskId } = request.params as any
    const body = request.body as any
    const isMember = await roomService.isMember(id, user.id)
    if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    await taskService.assertTaskInRoom(taskId, id)
    const beforeTask = await taskService.getTask(taskId)
    const updates = body.updates || body
    const task = await taskService.updateTask(taskId, updates)
    if (task.assigneeId && task.assigneeId !== beforeTask.assigneeId) notificationService.notifyTaskAssigned({ roomId: id, taskId: task.id, title: task.title, assigneeId: task.assigneeId, assigneeType: task.assigneeType, actorId: user.id, actorName: user.nickname || user.username })
    if (task.status !== beforeTask.status) notificationService.notifyTaskDone({ roomId: id, taskId: task.id, title: task.title, createdBy: task.createdBy, actorId: user.id, actorName: user.nickname || user.username, status: task.status })
    getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task }, timestamp: Date.now() })
    return reply.send({ success: true, data: { task } })
  })

  // Delete task via REST (WS parity)
  app.delete('/api/rooms/:id/tasks/:taskId', async (request, reply) => {
    const user = (request as any).user
    const { id, taskId } = request.params as any
    const isMember = await roomService.isMember(id, user.id)
    if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    await taskService.assertTaskInRoom(taskId, id)
    await taskService.deleteTask(taskId)
    getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'delete', task_id: taskId }, timestamp: Date.now() })
    return reply.send({ success: true })
  })

  // Retry failed task items via REST
  app.post('/api/rooms/:id/tasks/:taskId/retry', async (request, reply) => {
    const user = (request as any).user
    const { id, taskId } = request.params as any
    const { reason } = request.body as any || {}
    const isMember = await roomService.isMember(id, user.id)
    if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    await taskService.assertTaskInRoom(taskId, id)
    const result = await taskRetryService.retryTaskFailedItems(taskId, user.id, reason)
    getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task: result.task }, timestamp: Date.now() })
    return reply.send({ success: true, data: result })
  })

  // Create subtask via REST
  app.post('/api/rooms/:id/tasks/:taskId/subtasks', async (request, reply) => {
    const user = (request as any).user
    const { id, taskId } = request.params as any
    const body = request.body as any
    const isMember = await roomService.isMember(id, user.id)
    if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    await taskService.assertTaskInRoom(taskId, id)
    const subtask = await taskItemService.create(taskId, { title: body.title, description: body.description, status: body.status, assigneeId: body.assigneeId || body.assignee_id, assigneeName: body.assigneeName || body.assignee_name, assigneeType: body.assigneeType || body.assignee_type, blockedReason: body.blockedReason || body.blocked_reason, createdBy: user.id })
    notificationService.notifyTaskAssigned({ roomId: id, taskId, title: subtask.title, assigneeId: subtask.assigneeId, assigneeType: subtask.assigneeType, actorId: user.id, actorName: user.nickname || user.username, isSubtask: true })
    const task = await taskService.getTask(taskId)
    getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task }, timestamp: Date.now() })
    return reply.code(201).send({ success: true, data: { subtask, task } })
  })

  // Update subtask via REST
  app.patch('/api/rooms/:id/tasks/:taskId/subtasks/:itemId', async (request, reply) => {
    const user = (request as any).user
    const { id, taskId, itemId } = request.params as any
    const body = request.body as any
    const isMember = await roomService.isMember(id, user.id)
    if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    await taskService.assertTaskInRoom(taskId, id)
    const before = taskItemService.get(itemId)
    if (before.taskId !== taskId) return reply.code(400).send({ success: false, error: { code: 'TASK_ITEM_MISMATCH', message: 'Subtask does not belong to this task' } })
    const subtask = await taskItemService.update(itemId, body.updates || body)
    if (subtask.assigneeId && subtask.assigneeId !== before.assigneeId) notificationService.notifyTaskAssigned({ roomId: id, taskId, title: subtask.title, assigneeId: subtask.assigneeId, assigneeType: subtask.assigneeType, actorId: user.id, actorName: user.nickname || user.username, isSubtask: true })
    const released = []
    if (subtask.status === 'done') for (const dep of taskItemService.readyDependents(subtask.id)) released.push(await taskItemService.releaseDependent(dep.id))
    const task = await taskService.getTask(taskId)
    if (subtask.status !== before.status) notificationService.notifyTaskDone({ roomId: id, taskId, title: subtask.title, createdBy: task.createdBy, actorId: user.id, actorName: user.nickname || user.username, status: subtask.status })
    getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task }, timestamp: Date.now() })
    return reply.send({ success: true, data: { subtask, task, released } })
  })

  // Delete subtask via REST
  app.delete('/api/rooms/:id/tasks/:taskId/subtasks/:itemId', async (request, reply) => {
    const user = (request as any).user
    const { id, taskId, itemId } = request.params as any
    const isMember = await roomService.isMember(id, user.id)
    if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    await taskService.assertTaskInRoom(taskId, id)
    const before = taskItemService.get(itemId)
    if (before.taskId !== taskId) return reply.code(400).send({ success: false, error: { code: 'TASK_ITEM_MISMATCH', message: 'Subtask does not belong to this task' } })
    await taskItemService.delete(itemId)
    const task = await taskService.getTask(taskId)
    getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task }, timestamp: Date.now() })
    return reply.send({ success: true, data: { task } })
  })

  // Retry subtask via REST
  app.post('/api/rooms/:id/tasks/:taskId/subtasks/:itemId/retry', async (request, reply) => {
    const user = (request as any).user
    const { id, taskId, itemId } = request.params as any
    const { reason } = request.body as any || {}
    const isMember = await roomService.isMember(id, user.id)
    if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    await taskService.assertTaskInRoom(taskId, id)
    const before = taskItemService.get(itemId)
    if (before.taskId !== taskId) return reply.code(400).send({ success: false, error: { code: 'TASK_ITEM_MISMATCH', message: 'Subtask does not belong to this task' } })
    const result = await taskRetryService.retrySubtask(itemId, user.id, reason)
    getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task: result.task }, timestamp: Date.now() })
    return reply.send({ success: true, data: result })
  })

  // Get room members
  app.get('/api/rooms/:id/members', async (request, reply) => {
    const { id } = request.params as any

    try {
      const members = await roomService.getRoomMembers(id)
      return reply.send({ success: true, data: { members } })
    } catch (err: any) {
      throw err
    }
  })

  // Add a user collaborator directly (owner/editor only)
  app.post('/api/rooms/:id/members', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const { userId, role = 'editor' } = request.body as any

    if (!userId) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'userId is required' }
      })
    }
    if (!['owner', 'editor', 'viewer'].includes(role)) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'invalid role' }
      })
    }

    const current = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(id, user.id) as any
    if (!current || !['owner', 'editor'].includes(current.role)) {
      return reply.code(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only project owner/editor can add collaborators' }
      })
    }

    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as any
    if (!target) {
      return reply.code(404).send({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' }
      })
    }

    await roomService.addMember(id, userId, role)
    await agentService.refreshRoomAgentContext(id).catch(() => {})
    const members = await roomService.getRoomMembers(id)
    getGateway()?.broadcast(id, {
      msgId: uuidv4(),
      roomId: id,
      type: 'broadcast',
      action: 'room.members_update',
      payload: { members },
      timestamp: Date.now()
    })
    return reply.send({ success: true, data: { members } })
  })

  // Create invite link
  app.post('/api/rooms/:id/invite-link', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const { max_uses, expires_in_days } = request.body as any

    const code = uuidv4().replace(/-/g, '').substring(0, 12)
    const now = Date.now()
    const expiresAt = expires_in_days ? now + (expires_in_days * 24 * 60 * 60 * 1000) : null

    db.prepare(`
      INSERT INTO room_invites (code, room_id, created_by, max_uses, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(code, id, user.id, max_uses || null, expiresAt, now)

    return reply.send({
      success: true,
      data: { code, url: `/invite?code=${code}`, expires_at: expiresAt }
    })
  })

  // Join room via invite code
  app.post('/api/rooms/join', async (request, reply) => {
    const user = (request as any).user
    const { invite_code } = request.body as any

    if (!invite_code) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invite code is required' }
      })
    }

    const invite: any = db.prepare('SELECT * FROM room_invites WHERE code = ?').get(invite_code)
    if (!invite) {
      return reply.code(404).send({
        success: false,
        error: { code: 'INVITE_NOT_FOUND', message: 'Invalid invite code' }
      })
    }

    if (invite.expires_at && invite.expires_at < Date.now()) {
      return reply.code(410).send({
        success: false,
        error: { code: 'INVITE_EXPIRED', message: 'Invite has expired' }
      })
    }

    if (invite.max_uses && invite.used_count >= invite.max_uses) {
      return reply.code(403).send({
        success: false,
        error: { code: 'INVITE_FULL', message: 'Invite has reached max uses' }
      })
    }

    // Add member
    await roomService.addMember(invite.room_id, user.id, 'editor')
    await agentService.refreshRoomAgentContext(invite.room_id).catch(() => {})

    // Increment used count
    db.prepare('UPDATE room_invites SET used_count = used_count + 1 WHERE code = ?').run(invite_code)

    const room = await roomService.getRoom(invite.room_id)
    const members = await roomService.getRoomMembers(invite.room_id)

    // Notify users already inside the room so their member panels refresh immediately.
    getGateway()?.broadcast(invite.room_id, {
      msgId: uuidv4(),
      roomId: invite.room_id,
      type: 'broadcast',
      action: 'room.members_update',
      payload: { members },
      timestamp: Date.now()
    })

    return reply.send({ success: true, data: { room, role: 'editor' } })
  })

  // Leave room
  app.post('/api/rooms/:id/leave', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any

    try {
      await roomService.removeMember(id, user.id)
      return reply.send({ success: true })
    } catch (err: any) {
      throw err
    }
  })
}
