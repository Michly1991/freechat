import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import db from '../../storage/db.js'
import { roomService } from '../../services/room.service.js'
import { agentService } from '../../services/agent.service.js'
import { getGateway } from '../../ws/gateway.js'
import { assertRoomMember, routeAuthError } from '../route-auth.js'
import { assertCanAddRoomMember, assertCanChangeRoomMemberRole, assertCanRemoveRoomMember } from '../../utils/room-authz.js'

function isDirectRoom(room: any) {
  return room?.roomKind === 'direct_user' || room?.roomKind === 'direct_agent' || room?.room_kind === 'direct_user' || room?.room_kind === 'direct_agent'
}

function directRoomName(room: any, newMember: any) {
  const base = String(room?.name || '').trim()
  const suffix = newMember?.nickname || newMember?.username || '新成员'
  return base && base !== suffix ? `${base}、${suffix}` : `${base || '新的群聊'}群聊`
}

async function copyDirectRoomAgents(targetRoomId: string, sourceAgents: any[], actorUserId: string) {
  for (const agent of sourceAgents) {
    await agentService.addAgentToRoom(targetRoomId, agent.sourceTemplateId || agent.id, actorUserId, {
      roomRole: agent.roomRole === 'assistant' ? 'assistant' : 'specialist',
      autoEnabled: agent.autoEnabled === true,
      priority: Number(agent.roomPriority || 0),
    }).catch(async () => {
      await agentService.addAgentToRoom(targetRoomId, agent.id, actorUserId, {
        roomRole: agent.roomRole === 'assistant' ? 'assistant' : 'specialist',
        autoEnabled: agent.autoEnabled === true,
        priority: Number(agent.roomPriority || 0),
      })
    })
  }
}

async function createGroupFromDirectRoom(sourceRoomId: string, actorUserId: string, userId: string, role: string) {
  const sourceRoom = await roomService.getRoom(sourceRoomId) as any
  const sourceMembers = await roomService.getRoomMembers(sourceRoomId)
  const sourceAgents = await agentService.getRoomAgents(sourceRoomId)
  const newMember = db.prepare('SELECT id, username, nickname FROM users WHERE id = ?').get(userId) as any
  if (!newMember) throw { code: 'USER_NOT_FOUND', message: 'User not found' }
  const actorRole = sourceMembers.find((m: any) => m.userId === actorUserId)?.role || 'owner'
  const memberIds = Array.from(new Set([...sourceMembers.map((m: any) => m.userId).filter((id: string) => id !== actorUserId), userId]))
  let room: any
  try {
    room = await roomService.createRoom(directRoomName(sourceRoom, newMember), `由私聊「${sourceRoom.name}」添加成员后新建的群聊；原私聊保持不变。`, actorUserId, memberIds, [], {
      skipDefaultAssistant: true,
      roomKind: 'group',
      workgroupId: sourceRoom.workgroupId,
      sourceRoomId,
      syncInitialMembersToWorkgroup: false,
    } as any)
    if (actorRole !== 'owner') await roomService.updateMemberRole(room.id, actorUserId, actorRole)
    if (role !== 'editor') await roomService.updateMemberRole(room.id, userId, role)
    await copyDirectRoomAgents(room.id, sourceAgents, actorUserId)
    await agentService.refreshRoomAgentContext(room.id).catch(() => {})
    return { room: await roomService.getRoom(room.id), members: await roomService.getRoomMembers(room.id), agents: await agentService.getRoomAgents(room.id), sourceRoom }
  } catch (err) {
    if (room?.id) await roomService.deleteRoom(room.id, actorUserId).catch(() => {})
    throw err
  }
}

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
    const sourceRoom = await roomService.getRoom(id) as any
    assertCanAddRoomMember(id, user.id, role)
    if (isDirectRoom(sourceRoom)) {
      const result = await createGroupFromDirectRoom(id, user.id, userId, role)
      getGateway()?.broadcast(result.room.id, {
        msgId: uuidv4(),
        roomId: result.room.id,
        type: 'broadcast',
        action: 'room.members_update',
        payload: { members: result.members, agents: result.agents },
        timestamp: Date.now()
      })
      return reply.send({ success: true, data: { room: result.room, members: result.members, agents: result.agents, sourceRoom: result.sourceRoom, createdRoom: true } })
    }
  } catch (err: any) {
    return routeAuthError(reply, err)
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
