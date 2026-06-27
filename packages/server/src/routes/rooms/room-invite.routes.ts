import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import db from '../../storage/db.js'
import { roomService } from '../../services/room.service.js'
import { agentService } from '../../services/agent.service.js'
import { getGateway } from '../../ws/gateway.js'
import { assertRoomEditor, routeAuthError } from '../route-auth.js'

export async function registerRoomInviteRoutes(app: FastifyInstance) {
// Create invite link
app.post('/api/rooms/:id/invite-link', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  const { max_uses, expires_in_days, role: requestedRole } = request.body as any
  const role = ['owner', 'editor', 'viewer'].includes(requestedRole) ? requestedRole : 'viewer'

  try {
    assertRoomEditor(id, user.id)
  } catch (err: any) {
    return routeAuthError(reply, err)
  }

  const code = uuidv4().replace(/-/g, '').substring(0, 12)
  const now = Date.now()
  const expiresAt = expires_in_days ? now + (expires_in_days * 24 * 60 * 60 * 1000) : null

  db.prepare(`
    INSERT INTO room_invites (code, room_id, created_by, max_uses, expires_at, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(code, id, user.id, max_uses || null, expiresAt, role, now)

  return reply.send({
    success: true,
    data: { code, url: `/invite?code=${code}`, expires_at: expiresAt, role }
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

  if (invite.revoked_at) {
    return reply.code(410).send({
      success: false,
      error: { code: 'INVITE_REVOKED', message: 'Invite has been revoked' }
    })
  }

  const room = await roomService.getRoom(invite.room_id)
  const inviteRole = ['owner', 'editor', 'viewer'].includes(invite.role) ? invite.role : 'viewer'
  // Add member
  await roomService.addMember(invite.room_id, user.id, inviteRole)
  await agentService.refreshRoomAgentContext(invite.room_id).catch(() => {})

  // Increment used count
  db.prepare('UPDATE room_invites SET used_count = used_count + 1 WHERE code = ?').run(invite_code)

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

  return reply.send({ success: true, data: { room, role: inviteRole } })
})

}
