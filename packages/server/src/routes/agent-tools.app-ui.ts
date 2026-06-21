import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { messageService } from '../services/message.service.js'
import { taskService } from '../services/task.service.js'
import { interactionService } from '../services/interaction.service.js'
import { membersService } from '../services/members.service.js'
import { agentService } from '../services/agent.service.js'
import { areFriends } from './friends.js'
import { config } from '../config.js'

interface AppUiToolContext {
  action: string
  args: any
  roomId: string
  actorUserId: string
  agentId: string
  broadcast: (roomId: string, action: string, payload: any) => void
}

const TOOL_NAMES = [
  'tool.list', 'tool.schema',
  'chat.list', 'chat.send',
  'task.list', 'task.create', 'task.update', 'task.progress', 'task.delete', 'task.retry', 'task.plan.create',
  'task.subtask.list', 'task.subtask.add', 'task.subtask.update', 'task.subtask.delete', 'task.subtask.retry',
  'file.list', 'file.read', 'file.info', 'file.write', 'file.mkdir', 'file.delete',
  'tab-config.list', 'tab-config.add-file', 'tab-config.remove-file',
  'tab.list', 'tab.get', 'tab.search', 'tab.create', 'tab.create-from-file', 'tab.update', 'tab.patch', 'tab.delete', 'tab.reorder', 'tab.set-default', 'tab.open', 'tab.action',
  'members.list', 'members.add', 'profiles.list', 'profiles.update', 'users.get', 'users.search',
  'agent.list-available', 'agent.room-list', 'agent.create-request', 'agent.add', 'agent.remove', 'agent.restart',
  'agent.detail', 'agent.update', 'agent.skill.list', 'agent.skill.create', 'agent.skill.update', 'agent.skill.delete',
  'agent.script.list', 'agent.script.create', 'agent.script.update', 'agent.script.delete',
  'scene.list', 'scene.create', 'scene.update',
  'interaction.create', 'interaction.list', 'interaction.get', 'interaction.respond', 'interaction.consume', 'interaction.cancel',
  'conversation.list', 'conversation.mark-read', 'conversation.update-prefs',
  'friends.list', 'friends.requests', 'friends.request', 'friends.accept', 'friends.reject', 'friends.status',
  'dm.open', 'dm.get', 'dm.messages', 'dm.send',
  'room.info', 'room.update', 'room.create-invite',
]

function getUserSummary(userId: string) {
  const row = db.prepare('SELECT id, username, nickname, avatar, role, created_at FROM users WHERE id = ?').get(userId) as any
  if (!row) throw { code: 'USER_NOT_FOUND', message: 'User not found' }
  return { id: row.id, username: row.username, nickname: row.nickname, avatar: row.avatar, role: row.role, createdAt: row.created_at }
}

function ensureActorInDm(conversationId: string, actorUserId: string) {
  const row = db.prepare('SELECT * FROM dm_conversations WHERE id = ?').get(conversationId) as any
  if (!row || (row.user_a_id !== actorUserId && row.user_b_id !== actorUserId)) throw { code: 'DM_NOT_FOUND', message: 'DM conversation not found' }
  return row
}

function ensureConversationPref(actorUserId: string, type: string, id: string) {
  db.prepare(`
    INSERT OR IGNORE INTO conversation_prefs (user_id, conversation_type, conversation_id, pinned, muted, hidden, last_read_at, updated_at)
    VALUES (?, ?, ?, 0, 0, 0, 0, ?)
  `).run(actorUserId, type, id, Date.now())
}

function listConversations(actorUserId: string) {
  const projects = db.prepare(`
    SELECT r.*, rm.role as member_role FROM rooms r
    INNER JOIN room_members rm ON r.id = rm.room_id
    WHERE rm.user_id = ?
    ORDER BY r.last_active_at DESC
  `).all(actorUserId) as any[]
  const dms = db.prepare(`
    SELECT dc.*, u.id as other_id, u.username as other_username, u.nickname as other_nickname, u.avatar as other_avatar
    FROM dm_conversations dc
    INNER JOIN users u ON u.id = CASE WHEN dc.user_a_id = ? THEN dc.user_b_id ELSE dc.user_a_id END
    WHERE dc.user_a_id = ? OR dc.user_b_id = ?
    ORDER BY dc.last_active_at DESC
  `).all(actorUserId, actorUserId, actorUserId) as any[]
  return [
    ...projects.map((row) => ({ id: row.id, type: 'project', title: row.name, description: row.description, memberRole: row.member_role, lastActiveAt: row.last_active_at })),
    ...dms.map((row) => ({ id: row.id, type: 'dm', title: row.other_nickname || row.other_username, otherUserId: row.other_id, avatar: row.other_avatar, lastActiveAt: row.last_active_at })),
  ]
}

export async function handleAppUiTool(ctx: AppUiToolContext): Promise<{ handled: boolean; response?: any }> {
  const { action, args, roomId, actorUserId, agentId, broadcast } = ctx
  switch (action) {
    case 'tool.list':
      return { handled: true, response: { success: true, data: { tools: TOOL_NAMES } } }
    case 'tool.schema': {
      const name = String(args.name || args.tool || args.action || '').trim()
      if (!name) throw { code: 'VALIDATION_ERROR', message: 'tool name is required' }
      return { handled: true, response: { success: true, data: { name, input: 'JSON object args; run ./freechat help for common command forms', transport: { action: name, args: {} } } } }
    }
    case 'chat.list': {
      const limit = Math.max(1, Math.min(Number(args.limit || config.agent.chatRecentDefaultLimit) || config.agent.chatRecentDefaultLimit, 200))
      const messages = await messageService.getMessages(roomId, limit, args.before)
      return { handled: true, response: { success: true, data: { messages } } }
    }
    case 'task.delete': {
      const taskId = args.taskId || args.id || args.task_id
      if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'taskId is required' }
      await taskService.assertTaskInRoom(taskId, roomId)
      await taskService.deleteTask(taskId)
      broadcast(roomId, 'task.changed', { action: 'delete', taskId })
      return { handled: true, response: { success: true } }
    }
    case 'interaction.cancel': {
      const interaction = interactionService.cancel(roomId, args.id || args.interactionId, agentId)
      broadcast(roomId, 'interaction.updated', { interaction })
      return { handled: true, response: { success: true, data: { interaction } } }
    }
    case 'agent.room-list':
    case 'agent.room_list': {
      const agents = await agentService.getRoomAgents(roomId)
      return { handled: true, response: { success: true, data: { agents } } }
    }
    case 'profiles.list': {
      const profiles = await membersService.getRoomProfiles(roomId)
      return { handled: true, response: { success: true, data: { profiles } } }
    }
    case 'users.get': {
      const userId = args.userId || args.id
      if (!userId) throw { code: 'VALIDATION_ERROR', message: 'userId is required' }
      return { handled: true, response: { success: true, data: { user: getUserSummary(userId) } } }
    }
    case 'users.search': {
      const q = String(args.q || args.query || '').trim()
      if (!q) throw { code: 'VALIDATION_ERROR', message: 'query is required' }
      const rows = db.prepare(`
        SELECT id, username, nickname, avatar, role, created_at
        FROM users
        WHERE username LIKE ? OR nickname LIKE ?
        ORDER BY username ASC
        LIMIT ?
      `).all(`%${q}%`, `%${q}%`, Math.max(1, Math.min(Number(args.limit || 20) || 20, 50))) as any[]
      const users = rows.map((row) => ({ id: row.id, username: row.username, nickname: row.nickname, avatar: row.avatar, role: row.role, createdAt: row.created_at }))
      return { handled: true, response: { success: true, data: { users } } }
    }
    case 'conversation.list':
      return { handled: true, response: { success: true, data: { conversations: listConversations(actorUserId) } } }
    case 'conversation.mark-read': {
      const type = args.type
      const id = args.id || args.conversationId
      if (!type || !id || !['dm', 'project'].includes(type)) throw { code: 'VALIDATION_ERROR', message: 'type and id are required' }
      ensureConversationPref(actorUserId, type, id)
      db.prepare(`UPDATE conversation_prefs SET last_read_at = ?, updated_at = ? WHERE user_id = ? AND conversation_type = ? AND conversation_id = ?`).run(Date.now(), Date.now(), actorUserId, type, id)
      return { handled: true, response: { success: true } }
    }
    case 'conversation.update-prefs': {
      const type = args.type
      const id = args.id || args.conversationId
      if (!type || !id || !['dm', 'project'].includes(type)) throw { code: 'VALIDATION_ERROR', message: 'type and id are required' }
      ensureConversationPref(actorUserId, type, id)
      const updates: string[] = []
      const values: any[] = []
      for (const key of ['pinned', 'muted', 'hidden']) if (args[key] !== undefined) { updates.push(`${key} = ?`); values.push(args[key] ? 1 : 0) }
      if (updates.length > 0) {
        updates.push('updated_at = ?')
        values.push(Date.now(), actorUserId, type, id)
        db.prepare(`UPDATE conversation_prefs SET ${updates.join(', ')} WHERE user_id = ? AND conversation_type = ? AND conversation_id = ?`).run(...values)
      }
      return { handled: true, response: { success: true } }
    }
    case 'friends.list': {
      const rows = db.prepare(`SELECT u.id, u.username, u.nickname, u.avatar, u.role, u.created_at, f.created_at as friend_since FROM friendships f INNER JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? ORDER BY u.nickname ASC, u.username ASC`).all(actorUserId) as any[]
      const friends = rows.map((row) => ({ id: row.id, username: row.username, nickname: row.nickname, avatar: row.avatar, role: row.role, createdAt: row.created_at, friendSince: row.friend_since }))
      return { handled: true, response: { success: true, data: { friends } } }
    }
    case 'friends.requests': {
      const received = db.prepare(`SELECT fr.*, u.username, u.nickname, u.avatar FROM friend_requests fr INNER JOIN users u ON u.id = fr.from_user_id WHERE fr.to_user_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC`).all(actorUserId)
      const sent = db.prepare(`SELECT fr.*, u.username, u.nickname, u.avatar FROM friend_requests fr INNER JOIN users u ON u.id = fr.to_user_id WHERE fr.from_user_id = ? AND fr.status = 'pending' ORDER BY fr.created_at DESC`).all(actorUserId)
      return { handled: true, response: { success: true, data: { received, sent } } }
    }
    case 'friends.request': {
      const targetUserId = args.targetUserId || args.userId || args.id
      if (!targetUserId) throw { code: 'VALIDATION_ERROR', message: 'targetUserId is required' }
      if (targetUserId === actorUserId) throw { code: 'CANNOT_ADD_SELF', message: '不能添加自己为好友' }
      getUserSummary(targetUserId)
      if (areFriends(actorUserId, targetUserId)) throw { code: 'ALREADY_FRIENDS', message: '你们已经是好友' }
      const pending = db.prepare(`SELECT id FROM friend_requests WHERE status = 'pending' AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))`).get(actorUserId, targetUserId, targetUserId, actorUserId) as any
      if (pending) throw { code: 'REQUEST_PENDING', message: '已有待处理的好友申请' }
      const id = `fr_${uuidv4()}`
      const now = Date.now()
      db.prepare(`INSERT INTO friend_requests (id, from_user_id, to_user_id, message, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)`).run(id, actorUserId, targetUserId, args.message || null, now, now)
      return { handled: true, response: { success: true, data: { request: { id, status: 'pending' } } } }
    }
    case 'friends.accept': {
      const id = args.id || args.requestId
      if (!id) throw { code: 'VALIDATION_ERROR', message: 'requestId is required' }
      const reqRow = db.prepare(`SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'`).get(id, actorUserId) as any
      if (!reqRow) throw { code: 'REQUEST_NOT_FOUND', message: '好友申请不存在' }
      const now = Date.now()
      db.transaction(() => {
        db.prepare(`UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?`).run(now, id)
        db.prepare(`INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)`).run(reqRow.from_user_id, reqRow.to_user_id, now)
        db.prepare(`INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)`).run(reqRow.to_user_id, reqRow.from_user_id, now)
      })()
      return { handled: true, response: { success: true } }
    }
    case 'friends.reject': {
      const id = args.id || args.requestId
      if (!id) throw { code: 'VALIDATION_ERROR', message: 'requestId is required' }
      const result = db.prepare(`UPDATE friend_requests SET status = 'rejected', updated_at = ? WHERE id = ? AND to_user_id = ? AND status = 'pending'`).run(Date.now(), id, actorUserId)
      if (result.changes === 0) throw { code: 'REQUEST_NOT_FOUND', message: '好友申请不存在' }
      return { handled: true, response: { success: true } }
    }
    case 'friends.status': {
      const userId = args.userId || args.id
      if (!userId) throw { code: 'VALIDATION_ERROR', message: 'userId is required' }
      const status = userId === actorUserId ? 'self' : (areFriends(actorUserId, userId) ? 'friends' : 'none')
      return { handled: true, response: { success: true, data: { status } } }
    }
    case 'dm.open': {
      const userId = args.userId || args.id
      if (!userId) throw { code: 'VALIDATION_ERROR', message: 'userId is required' }
      if (userId === actorUserId) throw { code: 'VALIDATION_ERROR', message: 'cannot open DM with self' }
      const userA = [actorUserId, userId].sort()[0]
      const userB = [actorUserId, userId].sort()[1]
      let row = db.prepare('SELECT * FROM dm_conversations WHERE user_a_id = ? AND user_b_id = ?').get(userA, userB) as any
      if (!row) {
        const id = `dm_${uuidv4()}`
        const now = Date.now()
        db.prepare(`INSERT INTO dm_conversations (id, user_a_id, user_b_id, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)`).run(id, userA, userB, now, now, now)
        row = db.prepare('SELECT * FROM dm_conversations WHERE id = ?').get(id) as any
      }
      return { handled: true, response: { success: true, data: { conversation: row } } }
    }
    case 'dm.get': {
      const conversationId = args.id || args.conversationId
      if (!conversationId) throw { code: 'VALIDATION_ERROR', message: 'conversationId is required' }
      return { handled: true, response: { success: true, data: { conversation: ensureActorInDm(conversationId, actorUserId) } } }
    }
    case 'dm.messages': {
      const conversationId = args.id || args.conversationId
      if (!conversationId) throw { code: 'VALIDATION_ERROR', message: 'conversationId is required' }
      ensureActorInDm(conversationId, actorUserId)
      const messages = db.prepare(`SELECT * FROM dm_messages WHERE conversation_id = ? AND deleted = 0 ORDER BY created_at DESC LIMIT ?`).all(conversationId, Math.max(1, Math.min(Number(args.limit || 100) || 100, 200)))
      return { handled: true, response: { success: true, data: { messages: (messages as any[]).reverse() } } }
    }
    case 'dm.send': {
      const conversationId = args.id || args.conversationId
      const content = String(args.content || '').trim()
      if (!conversationId || !content) throw { code: 'VALIDATION_ERROR', message: 'conversationId and content are required' }
      ensureActorInDm(conversationId, actorUserId)
      const actor = getUserSummary(actorUserId)
      const id = `dmm_${uuidv4()}`
      const now = Date.now()
      db.prepare(`INSERT INTO dm_messages (id, conversation_id, actor_id, actor_name, actor_type, content, created_at, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`).run(id, conversationId, actorUserId, actor.nickname || actor.username, actor.role === 'agent' ? 'ai' : 'human', content, now)
      db.prepare(`UPDATE dm_conversations SET last_active_at = ?, updated_at = ? WHERE id = ?`).run(now, now, conversationId)
      return { handled: true, response: { success: true, data: { message: { id, conversationId, actorId: actorUserId, content, createdAt: now } } } }
    }
    default:
      return { handled: false }
  }
}
