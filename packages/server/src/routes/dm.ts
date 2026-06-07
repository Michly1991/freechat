import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { areFriends } from './friends.js'
import { MAX_MESSAGES_PER_ROOM } from '@freechat/shared'

function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

function mapConversation(row: any, currentUserId: string) {
  const otherId = row.user_a_id === currentUserId ? row.user_b_id : row.user_a_id
  return {
    id: row.id,
    type: 'dm',
    userAId: row.user_a_id,
    userBId: row.user_b_id,
    otherUser: {
      id: otherId,
      username: row.other_username,
      nickname: row.other_nickname,
      avatar: row.other_avatar,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at,
  }
}

function ensureDmMember(conversationId: string, userId: string): any {
  const row = db.prepare('SELECT * FROM dm_conversations WHERE id = ?').get(conversationId) as any
  if (!row || (row.user_a_id !== userId && row.user_b_id !== userId)) {
    throw { code: 'DM_NOT_FOUND', message: '单聊不存在或无权访问' }
  }
  return row
}

function cleanupDmMessages(conversationId: string) {
  const count: any = db.prepare('SELECT COUNT(*) as count FROM dm_messages WHERE conversation_id = ? AND deleted = 0').get(conversationId)
  if (count.count > MAX_MESSAGES_PER_ROOM) {
    const oldRows = db.prepare(`
      SELECT id FROM dm_messages
      WHERE conversation_id = ? AND deleted = 0
      ORDER BY created_at ASC
      LIMIT ?
    `).all(conversationId, count.count - MAX_MESSAGES_PER_ROOM) as any[]
    const ids = oldRows.map((r) => r.id)
    if (ids.length > 0) {
      db.prepare(`UPDATE dm_messages SET deleted = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
    }
  }
}

export async function registerDmRoutes(app: FastifyInstance) {
  app.post('/api/dm/open', async (request, reply) => {
    const user = (request as any).user
    const { userId } = request.body as any
    if (!userId) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'userId is required' } })
    }
    if (userId === user.id) {
      return reply.code(400).send({ success: false, error: { code: 'CANNOT_DM_SELF', message: '不能和自己单聊' } })
    }
    if (!areFriends(user.id, userId)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_FRIENDS', message: '只能和好友单聊' } })
    }

    const [userA, userB] = normalizePair(user.id, userId)
    let row = db.prepare('SELECT * FROM dm_conversations WHERE user_a_id = ? AND user_b_id = ?').get(userA, userB) as any
    if (!row) {
      const id = `dm_${uuidv4()}`
      const now = Date.now()
      db.prepare(`
        INSERT INTO dm_conversations (id, user_a_id, user_b_id, created_at, updated_at, last_active_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, userA, userB, now, now, now)
      row = db.prepare('SELECT * FROM dm_conversations WHERE id = ?').get(id) as any
    }

    const other = db.prepare('SELECT username, nickname, avatar FROM users WHERE id = ?').get(userId) as any
    return reply.send({ success: true, data: { conversation: mapConversation({ ...row, other_username: other.username, other_nickname: other.nickname, other_avatar: other.avatar }, user.id) } })
  })

  app.get('/api/dm/:id', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try {
      const row = ensureDmMember(id, user.id)
      const otherId = row.user_a_id === user.id ? row.user_b_id : row.user_a_id
      const other = db.prepare('SELECT username, nickname, avatar FROM users WHERE id = ?').get(otherId) as any
      return reply.send({ success: true, data: { conversation: mapConversation({ ...row, other_username: other.username, other_nickname: other.nickname, other_avatar: other.avatar }, user.id) } })
    } catch (err: any) {
      return reply.code(404).send({ success: false, error: err })
    }
  })

  app.get('/api/dm/:id/messages', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const { limit } = request.query as any
    try {
      ensureDmMember(id, user.id)
      const rows = db.prepare(`
        SELECT * FROM dm_messages
        WHERE conversation_id = ? AND deleted = 0
        ORDER BY created_at DESC
        LIMIT ?
      `).all(id, Math.min(parseInt(limit || '100'), 100)) as any[]

      const messages = rows.reverse().map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        actorId: row.actor_id,
        actorName: row.actor_name,
        content: row.content,
        editedAt: row.edited_at,
        deleted: !!row.deleted,
        createdAt: row.created_at,
      }))

      return reply.send({ success: true, data: { messages } })
    } catch (err: any) {
      return reply.code(404).send({ success: false, error: err })
    }
  })

  app.post('/api/dm/:id/messages', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const { content } = request.body as any
    if (!content || !content.trim()) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'content is required' } })
    }

    try {
      ensureDmMember(id, user.id)
      const now = Date.now()
      const msgId = `dmmsg_${uuidv4()}`
      db.prepare(`
        INSERT INTO dm_messages (id, conversation_id, actor_id, actor_name, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(msgId, id, user.id, user.nickname || user.username, content.trim(), now)
      db.prepare('UPDATE dm_conversations SET updated_at = ?, last_active_at = ? WHERE id = ?').run(now, now, id)
      cleanupDmMessages(id)

      const message = {
        id: msgId,
        conversationId: id,
        actorId: user.id,
        actorName: user.nickname || user.username,
        content: content.trim(),
        deleted: false,
        createdAt: now,
      }
      return reply.send({ success: true, data: { message } })
    } catch (err: any) {
      return reply.code(404).send({ success: false, error: err })
    }
  })
}
