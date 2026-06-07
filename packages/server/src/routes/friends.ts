import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'

function mapUser(row: any) {
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatar: row.avatar,
    role: row.role,
    createdAt: row.created_at,
  }
}

function areFriends(userId: string, friendId: string): boolean {
  return !!db.prepare('SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?').get(userId, friendId)
}

function getFriendStatus(currentUserId: string, targetUserId: string): string {
  if (currentUserId === targetUserId) return 'self'
  if (areFriends(currentUserId, targetUserId)) return 'friends'

  const sent = db.prepare(`
    SELECT 1 FROM friend_requests
    WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
  `).get(currentUserId, targetUserId)
  if (sent) return 'pending_sent'

  const received = db.prepare(`
    SELECT 1 FROM friend_requests
    WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'
  `).get(targetUserId, currentUserId)
  if (received) return 'pending_received'

  return 'none'
}

export async function registerFriendRoutes(app: FastifyInstance) {
  app.get('/api/friends', async (request, reply) => {
    const user = (request as any).user
    const rows = db.prepare(`
      SELECT u.id, u.username, u.nickname, u.avatar, u.role, u.created_at, f.created_at as friend_since
      FROM friendships f
      INNER JOIN users u ON u.id = f.friend_id
      WHERE f.user_id = ?
      ORDER BY u.nickname ASC, u.username ASC
    `).all(user.id) as any[]

    return reply.send({ success: true, data: { friends: rows.map(mapUser) } })
  })

  app.get('/api/friends/requests', async (request, reply) => {
    const user = (request as any).user
    const receivedRows = db.prepare(`
      SELECT fr.*, u.username, u.nickname, u.avatar
      FROM friend_requests fr
      INNER JOIN users u ON u.id = fr.from_user_id
      WHERE fr.to_user_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `).all(user.id) as any[]

    const sentRows = db.prepare(`
      SELECT fr.*, u.username, u.nickname, u.avatar
      FROM friend_requests fr
      INNER JOIN users u ON u.id = fr.to_user_id
      WHERE fr.from_user_id = ? AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `).all(user.id) as any[]

    const mapRequest = (row: any) => ({
      id: row.id,
      fromUserId: row.from_user_id,
      toUserId: row.to_user_id,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      user: {
        id: row.from_user_id === user.id ? row.to_user_id : row.from_user_id,
        username: row.username,
        nickname: row.nickname,
        avatar: row.avatar,
      }
    })

    return reply.send({ success: true, data: { received: receivedRows.map(mapRequest), sent: sentRows.map(mapRequest) } })
  })

  app.post('/api/friends/requests', async (request, reply) => {
    const user = (request as any).user
    const { targetUserId, message } = request.body as any

    if (!targetUserId) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'targetUserId is required' } })
    }
    if (targetUserId === user.id) {
      return reply.code(400).send({ success: false, error: { code: 'CANNOT_ADD_SELF', message: '不能添加自己为好友' } })
    }

    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId)
    if (!target) {
      return reply.code(404).send({ success: false, error: { code: 'USER_NOT_FOUND', message: '用户不存在' } })
    }
    if (areFriends(user.id, targetUserId)) {
      return reply.code(409).send({ success: false, error: { code: 'ALREADY_FRIENDS', message: '你们已经是好友' } })
    }

    const pending = db.prepare(`
      SELECT id FROM friend_requests
      WHERE status = 'pending'
        AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
    `).get(user.id, targetUserId, targetUserId, user.id) as any
    if (pending) {
      return reply.code(409).send({ success: false, error: { code: 'REQUEST_PENDING', message: '已有待处理的好友申请' } })
    }

    const id = `fr_${uuidv4()}`
    const now = Date.now()
    db.prepare(`
      INSERT INTO friend_requests (id, from_user_id, to_user_id, message, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, user.id, targetUserId, message || null, now, now)

    return reply.send({ success: true, data: { request: { id, status: 'pending' } } })
  })

  app.post('/api/friends/requests/:id/accept', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const reqRow = db.prepare(`SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'`).get(id, user.id) as any
    if (!reqRow) {
      return reply.code(404).send({ success: false, error: { code: 'REQUEST_NOT_FOUND', message: '好友申请不存在' } })
    }

    const now = Date.now()
    const accept = db.transaction(() => {
      db.prepare(`UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?`).run(now, id)
      db.prepare(`INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)`).run(reqRow.from_user_id, reqRow.to_user_id, now)
      db.prepare(`INSERT OR IGNORE INTO friendships (user_id, friend_id, created_at) VALUES (?, ?, ?)`).run(reqRow.to_user_id, reqRow.from_user_id, now)
    })
    accept()

    return reply.send({ success: true })
  })

  app.post('/api/friends/requests/:id/reject', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const result = db.prepare(`
      UPDATE friend_requests SET status = 'rejected', updated_at = ?
      WHERE id = ? AND to_user_id = ? AND status = 'pending'
    `).run(Date.now(), id, user.id)

    if (result.changes === 0) {
      return reply.code(404).send({ success: false, error: { code: 'REQUEST_NOT_FOUND', message: '好友申请不存在' } })
    }
    return reply.send({ success: true })
  })

  app.get('/api/friends/status/:userId', async (request, reply) => {
    const user = (request as any).user
    const { userId } = request.params as any
    return reply.send({ success: true, data: { status: getFriendStatus(user.id, userId) } })
  })
}

export { getFriendStatus, areFriends, mapUser }
