import { FastifyInstance } from 'fastify'
import { roomService } from '../services/room.service.js'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { getGateway } from '../ws/gateway.js'
import { areFriends } from './friends.js'

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
    const { name, description, memberIds } = request.body as any

    if (!name) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Room name is required' }
      })
    }

    try {
      const initialMemberIds = Array.isArray(memberIds)
        ? memberIds.filter((id: string) => id && id !== user.id && areFriends(user.id, id))
        : []
      const room = await roomService.createRoom(name, description || null, user.id, initialMemberIds)
      return reply.send({ success: true, data: { room } })
    } catch (err: any) {
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
