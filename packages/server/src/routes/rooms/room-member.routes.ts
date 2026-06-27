import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import db from '../../storage/db.js'
import { roomService } from '../../services/room.service.js'
import { agentService } from '../../services/agent.service.js'
import { getGateway } from '../../ws/gateway.js'
import { assertRoomMember, routeAuthError } from '../route-auth.js'
import { assertCanAddRoomMember, assertCanChangeRoomMemberRole, assertCanRemoveRoomMember } from '../../utils/room-authz.js'

export async function registerRoomMemberRoutes(app: FastifyInstance) {
// Get room members
app.get('/api/rooms/:id/members', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any

  try {
    assertRoomMember(id, user.id)
    const members = await roomService.getRoomMembers(id)
    return reply.send({ success: true, data: { members } })
  } catch (err: any) {
    if (err.code === 'NOT_ROOM_MEMBER' || err.code === 'FORBIDDEN') return routeAuthError(reply, err)
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

  try {
    assertCanAddRoomMember(id, user.id, role)
  } catch (err: any) {
    return routeAuthError(reply, err)
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

// Update a room member role (owner only; room must keep at least one owner)
app.patch('/api/rooms/:id/members/:userId', async (request, reply) => {
  const user = (request as any).user
  const { id, userId } = request.params as any
  const { role } = request.body as any
  if (!['owner', 'editor', 'viewer'].includes(role)) {
    return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'invalid role' } })
  }
  try {
    assertCanChangeRoomMemberRole(id, user.id, userId, role)
    await roomService.updateMemberRole(id, userId, role)
    await agentService.refreshRoomAgentContext(id).catch(() => {})
    const members = await roomService.getRoomMembers(id)
    getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'room.members_update', payload: { members }, timestamp: Date.now() })
    return reply.send({ success: true, data: { members } })
  } catch (err: any) {
    if (err.code === 'NOT_ROOM_MEMBER' || err.code === 'FORBIDDEN' || err.code === 'LAST_OWNER_REQUIRED') return routeAuthError(reply, err)
    throw err
  }
})

// Remove a room member (owner only except self-leave; room must keep at least one owner)
app.delete('/api/rooms/:id/members/:userId', async (request, reply) => {
  const user = (request as any).user
  const { id, userId } = request.params as any
  try {
    assertCanRemoveRoomMember(id, user.id, userId)
    await roomService.removeMember(id, userId)
    await agentService.refreshRoomAgentContext(id).catch(() => {})
    const members = await roomService.getRoomMembers(id)
    getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'room.members_update', payload: { members }, timestamp: Date.now() })
    return reply.send({ success: true, data: { members } })
  } catch (err: any) {
    if (err.code === 'NOT_ROOM_MEMBER' || err.code === 'FORBIDDEN' || err.code === 'LAST_OWNER_REQUIRED') return routeAuthError(reply, err)
    throw err
  }
})

}
