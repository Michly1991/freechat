import { FastifyInstance } from 'fastify'
import { membersService } from '../services/members.service.js'
import { roomService } from '../services/room.service.js'
import db from '../storage/db.js'
import { getFriendStatus } from './friends.js'
import { agentService } from '../services/agent.service.js'

export async function registerProfileRoutes(app: FastifyInstance) {
  // GET /api/rooms/:roomId/profiles - get all profiles
  app.get('/api/rooms/:roomId/profiles', async (request, reply) => {
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

      const profiles = await membersService.getRoomProfiles(roomId)
      return reply.send({ success: true, data: { profiles } })
    } catch (err: any) {
      throw err
    }
  })

  // PUT /api/rooms/:roomId/profiles/:memberId - set/update profile
  app.put('/api/rooms/:roomId/profiles/:memberId', async (request, reply) => {
    const user = (request as any).user
    const { roomId, memberId } = request.params as any
    const body = request.body as any

    try {
      const isMember = await roomService.isMember(roomId, user.id)
      if (!isMember) {
        return reply.code(403).send({
          success: false,
          error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' }
        })
      }

      // Only allow users to update their own profile, or room owners can update any
      const room = await roomService.getRoom(roomId)
      const isOwner = room.createdBy === user.id
      const isSelf = memberId === user.id

      if (!isSelf && !isOwner) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You can only update your own profile' }
        })
      }

      const profile = await membersService.setProfile(roomId, memberId, {
        displayName: body.displayName || body.roleTitle,
        roleDescription: body.roleDescription || body.persona,
        avatar: body.avatar,
        customData: body.customData || {
          specialties: body.specialties,
          canApprove: body.canApprove,
          escalationLevel: body.escalationLevel,
          roleTitle: body.roleTitle,
          persona: body.persona,
        },
      })
      await agentService.refreshRoomAgentContext(roomId).catch(() => {})

      return reply.send({ success: true, data: { profile } })
    } catch (err: any) {
      if (err.code === 'MEMBER_NOT_FOUND') {
        return reply.code(404).send({ success: false, error: err })
      }
      throw err
    }
  })

  // POST /api/rooms/:roomId/profiles/batch - batch update profiles
  app.post('/api/rooms/:roomId/profiles/batch', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    const { profiles } = request.body as any

    if (!profiles || !Array.isArray(profiles)) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'profiles array is required' }
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

      // Only room owners can batch update
      const room = await roomService.getRoom(roomId)
      if (room.createdBy !== user.id) {
        return reply.code(403).send({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Only room owners can batch update profiles' }
        })
      }

      await membersService.batchUpdateProfiles(roomId, profiles)
      await agentService.refreshRoomAgentContext(roomId).catch(() => {})
      return reply.send({ success: true })
    } catch (err: any) {
      throw err
    }
  })

  // GET /api/users/:userId - get user info
  app.get('/api/users/:userId', async (request, reply) => {
    const { userId } = request.params as any

    try {
      const row = db.prepare(`
        SELECT id, username, nickname, avatar, role, identity_type, created_at
        FROM users WHERE id = ?
      `).get(userId) as any

      if (!row) {
        return reply.code(404).send({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' }
        })
      }

      return reply.send({
        success: true,
        data: {
          user: {
            id: row.id,
            username: row.username,
            nickname: row.nickname,
            avatar: row.avatar,
            role: row.role,
            identityType: row.identity_type || 'human',
            createdAt: row.created_at,
          }
        }
      })
    } catch (err: any) {
      throw err
    }
  })

  // GET /api/users/search?q=xxx - search users
  app.get('/api/users/search', async (request, reply) => {
    const user = (request as any).user
    const { q, limit = '20', pageToken } = request.query as any

    if (!q || q.length < 1) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Search query (q) is required' }
      })
    }

    try {
      const pageSize = Math.max(1, Math.min(Number(limit) || 20, 50))
      const offset = Math.max(0, Number(pageToken || 0) || 0)
      const rows = db.prepare(`
        SELECT id, username, nickname, avatar, role, identity_type, created_at
        FROM users
        WHERE username LIKE ? OR nickname LIKE ?
        ORDER BY username ASC
        LIMIT ? OFFSET ?
      `).all(`%${q}%`, `%${q}%`, pageSize + 1, offset) as any[]

      const hasMore = rows.length > pageSize
      const pageRows = hasMore ? rows.slice(0, pageSize) : rows
      const users = pageRows.map(row => ({
        id: row.id,
        username: row.username,
        nickname: row.nickname,
        avatar: row.avatar,
        role: row.role,
        identityType: row.identity_type || 'human',
        createdAt: row.created_at,
        friendStatus: getFriendStatus(user.id, row.id),
      }))

      return reply.send({ success: true, data: { users, hasMore, nextPageToken: hasMore ? String(offset + pageSize) : null } })
    } catch (err: any) {
      throw err
    }
  })
}
