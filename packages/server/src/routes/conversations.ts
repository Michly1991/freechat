import { FastifyInstance } from 'fastify'
import db from '../storage/db.js'

function ensurePref(userId: string, type: string, id: string) {
  db.prepare(`
    INSERT OR IGNORE INTO conversation_prefs (user_id, conversation_type, conversation_id, pinned, muted, hidden, last_read_at, updated_at)
    VALUES (?, ?, ?, 0, 0, 0, 0, ?)
  `).run(userId, type, id, Date.now())
  return db.prepare(`
    SELECT * FROM conversation_prefs
    WHERE user_id = ? AND conversation_type = ? AND conversation_id = ?
  `).get(userId, type, id) as any
}

function getLastProjectMessage(roomId: string): any {
  return db.prepare(`
    SELECT actor_name, content, created_at FROM messages
    WHERE room_id = ? AND deleted = 0
    ORDER BY created_at DESC
    LIMIT 1
  `).get(roomId) as any
}

function getLastDmMessage(dmId: string): any {
  return db.prepare(`
    SELECT actor_name, content, created_at FROM dm_messages
    WHERE conversation_id = ? AND deleted = 0
    ORDER BY created_at DESC
    LIMIT 1
  `).get(dmId) as any
}

function countProjectUnread(roomId: string, userId: string, lastReadAt: number): number {
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM messages
    WHERE room_id = ? AND deleted = 0 AND created_at > ? AND actor_id != ?
  `).get(roomId, lastReadAt || 0, userId) as any
  return row?.count || 0
}

function countDmUnread(dmId: string, userId: string, lastReadAt: number): number {
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM dm_messages
    WHERE conversation_id = ? AND deleted = 0 AND created_at > ? AND actor_id != ?
  `).get(dmId, lastReadAt || 0, userId) as any
  return row?.count || 0
}

export async function registerConversationRoutes(app: FastifyInstance) {
  app.get('/api/conversations', async (request, reply) => {
    const user = (request as any).user

    const projects = db.prepare(`
      SELECT r.*, rm.role as member_role FROM rooms r
      INNER JOIN room_members rm ON r.id = rm.room_id
      WHERE rm.user_id = ?
    `).all(user.id) as any[]

    const dms = db.prepare(`
      SELECT dc.*, u.id as other_id, u.username as other_username, u.nickname as other_nickname, u.avatar as other_avatar
      FROM dm_conversations dc
      INNER JOIN users u ON u.id = CASE WHEN dc.user_a_id = ? THEN dc.user_b_id ELSE dc.user_a_id END
      WHERE dc.user_a_id = ? OR dc.user_b_id = ?
    `).all(user.id, user.id, user.id) as any[]

    const projectItems = projects.map((room) => {
      const pref = ensurePref(user.id, 'project', room.id)
      const last = getLastProjectMessage(room.id)
      const lastActiveAt = last?.created_at || room.last_active_at || room.updated_at || room.created_at
      return {
        id: room.id,
        type: 'project',
        title: room.name,
        avatar: null,
        subtitle: room.description || '项目房间',
        lastMessage: last ? { actorName: last.actor_name, content: last.content, createdAt: last.created_at } : null,
        lastActiveAt,
        unreadCount: countProjectUnread(room.id, user.id, pref.last_read_at),
        pinned: !!pref.pinned,
        muted: !!pref.muted,
        hidden: !!pref.hidden,
        lastReadAt: pref.last_read_at || 0,
        targetPath: `/room/${room.id}`,
        memberRole: room.member_role,
        canDelete: room.member_role === 'owner',
      }
    })

    const dmItems = dms.map((dm) => {
      const pref = ensurePref(user.id, 'dm', dm.id)
      const last = getLastDmMessage(dm.id)
      const title = dm.other_nickname || dm.other_username
      const lastActiveAt = last?.created_at || dm.last_active_at || dm.updated_at || dm.created_at
      return {
        id: dm.id,
        type: 'dm',
        title,
        avatar: dm.other_avatar,
        subtitle: `@${dm.other_username}`,
        lastMessage: last ? { actorName: last.actor_name, content: last.content, createdAt: last.created_at } : null,
        lastActiveAt,
        unreadCount: countDmUnread(dm.id, user.id, pref.last_read_at),
        pinned: !!pref.pinned,
        muted: !!pref.muted,
        hidden: !!pref.hidden,
        lastReadAt: pref.last_read_at || 0,
        targetPath: `/dm/${dm.id}`,
      }
    })

    const conversations = [...dmItems, ...projectItems].filter((item: any) => !item.hidden).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return (b.lastActiveAt || 0) - (a.lastActiveAt || 0)
    })

    return reply.send({ success: true, data: { conversations } })
  })

  app.post('/api/conversations/read', async (request, reply) => {
    const user = (request as any).user
    const { type, id } = request.body as any
    if (!type || !id || !['dm', 'project'].includes(type)) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type and id are required' } })
    }

    ensurePref(user.id, type, id)
    db.prepare(`
      UPDATE conversation_prefs
      SET last_read_at = ?, updated_at = ?
      WHERE user_id = ? AND conversation_type = ? AND conversation_id = ?
    `).run(Date.now(), Date.now(), user.id, type, id)

    return reply.send({ success: true })
  })

  app.patch('/api/conversations/:type/:id/prefs', async (request, reply) => {
    const user = (request as any).user
    const { type, id } = request.params as any
    const { pinned, muted, hidden } = request.body as any
    if (!['dm', 'project'].includes(type)) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'invalid conversation type' } })
    }

    ensurePref(user.id, type, id)
    const updates: string[] = []
    const values: any[] = []
    if (pinned !== undefined) { updates.push('pinned = ?'); values.push(pinned ? 1 : 0) }
    if (muted !== undefined) { updates.push('muted = ?'); values.push(muted ? 1 : 0) }
    if (hidden !== undefined) { updates.push('hidden = ?'); values.push(hidden ? 1 : 0) }
    if (updates.length === 0) return reply.send({ success: true })

    updates.push('updated_at = ?')
    values.push(Date.now(), user.id, type, id)
    db.prepare(`
      UPDATE conversation_prefs SET ${updates.join(', ')}
      WHERE user_id = ? AND conversation_type = ? AND conversation_id = ?
    `).run(...values)

    return reply.send({ success: true })
  })
}
