import { FastifyInstance } from 'fastify'
import db from '../storage/db.js'
import { roomService } from '../services/room.service.js'
import { agentService } from '../services/agent.service.js'
import { areFriends } from './friends.js'
import { builtInAgentBootstrapService } from '../services/built-in-agent-bootstrap.service.js'

function directKeyForUsers(userId: string, targetUserId: string) {
  return `user:${[userId, targetUserId].sort().join(':')}`
}

function directKeyForAgent(userId: string, agentId: string) {
  return `agent:${userId}:${agentId}`
}

async function getExistingRoomByDirectKey(directKey: string, userId: string) {
  const row = db.prepare(`
    SELECT r.id FROM rooms r
    INNER JOIN room_members rm ON rm.room_id = r.id AND rm.user_id = ?
    WHERE r.direct_key = ? AND r.deleted_at IS NULL
    LIMIT 1
  `).get(userId, directKey) as any
  return row?.id ? roomService.getRoom(row.id) : null
}

function getUserDisplayName(userId: string) {
  const user = db.prepare('SELECT username, nickname FROM users WHERE id = ?').get(userId) as any
  if (!user) throw { code: 'USER_NOT_FOUND', message: '用户不存在' }
  return user.nickname || user.username
}

export async function registerDirectRoomRoutes(app: FastifyInstance) {
  app.post('/api/rooms/direct/user', async (request, reply) => {
    const user = (request as any).user
    const { userId } = request.body as any
    if (!userId || userId === user.id) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: '请选择要私聊的用户' } })
    if (!areFriends(user.id, String(userId))) return reply.code(403).send({ success: false, error: { code: 'NOT_FRIENDS', message: '只能和好友发起聊天' } })

    const directKey = directKeyForUsers(user.id, String(userId))
    const existing = await getExistingRoomByDirectKey(directKey, user.id)
    if (existing) return reply.send({ success: true, data: { room: existing } })

    const title = getUserDisplayName(String(userId))
    const room = await roomService.createRoom(title, '单聊，可后续添加成员或 Agent 升级为协作房间。', user.id, [String(userId)], [], {
      skipDefaultAssistant: true,
      roomKind: 'direct_user',
      directKey,
      directTargetType: 'user',
      directTargetId: String(userId),
    })
    return reply.send({ success: true, data: { room } })
  })

  app.post('/api/rooms/direct/xiaomi', async (request, reply) => {
    const user = (request as any).user
    const agentId = builtInAgentBootstrapService.getXiaomiAgentId()
    const agent = await agentService.getAgent(agentId)
    const directKey = directKeyForAgent(user.id, agentId)
    const existing = await getExistingRoomByDirectKey(directKey, user.id)
    if (existing) {
      await agentService.addAgentToRoom(existing.id, agentId, user.id, { roomRole: 'assistant', autoEnabled: true })
      await agentService.refreshRoomAgentContext(existing.id).catch(() => {})
      return reply.send({ success: true, data: { room: await roomService.getRoom(existing.id), agent } })
    }

    const room = await roomService.createRoom(agent.name, '和小蜜的 AI 私聊。小蜜可以帮你操作 FreeChat、管理 Agent/Skill，并协助项目协作。', user.id, [], [], {
      skipDefaultAssistant: true,
      roomKind: 'direct_agent',
      directKey,
      directTargetType: 'agent',
      directTargetId: agentId,
    })
    try {
      await agentService.addAgentToRoom(room.id, agentId, user.id, { roomRole: 'assistant', autoEnabled: true })
      await agentService.refreshRoomAgentContext(room.id).catch(() => {})
      return reply.send({ success: true, data: { room: await roomService.getRoom(room.id), agent } })
    } catch (err) {
      await roomService.deleteRoom(room.id, user.id).catch(() => {})
      throw err
    }
  })

  app.post('/api/rooms/direct/agent', async (request, reply) => {
    const user = (request as any).user
    const { agentId } = request.body as any
    if (!agentId) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: '请选择要私聊的 Agent' } })
    if (!(await agentService.canUseAgent(String(agentId), user.id))) return reply.code(403).send({ success: false, error: { code: 'AGENT_NOT_AVAILABLE', message: '请先关注或选择自己创建的 Agent' } })

    const agent = await agentService.getAgent(String(agentId))
    const directKey = directKeyForAgent(user.id, String(agentId))
    const existing = await getExistingRoomByDirectKey(directKey, user.id)
    if (existing) return reply.send({ success: true, data: { room: existing } })

    const room = await roomService.createRoom(agent.name, `和 ${agent.name} 的 AI 私聊，可后续添加其他人或 Agent 升级为协作房间。`, user.id, [], [], {
      skipDefaultAssistant: true,
      roomKind: 'direct_agent',
      directKey,
      directTargetType: 'agent',
      directTargetId: String(agentId),
    })
    try {
      await agentService.addAgentToRoom(room.id, String(agentId), user.id, { roomRole: 'assistant', autoEnabled: true })
      await agentService.refreshRoomAgentContext(room.id).catch(() => {})
      return reply.send({ success: true, data: { room: await roomService.getRoom(room.id) } })
    } catch (err) {
      await roomService.deleteRoom(room.id, user.id).catch(() => {})
      throw err
    }
  })
}
