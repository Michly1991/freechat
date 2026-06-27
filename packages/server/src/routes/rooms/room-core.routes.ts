import { FastifyInstance } from 'fastify'
import { roomService } from '../../services/room.service.js'
import { agentService } from '../../services/agent.service.js'
import { sceneTemplateService } from '../../services/scene-template.service.js'
import { marketEngagementService } from '../../services/market-engagement.service.js'
import { workgroupService } from '../../services/workgroup.service.js'
import { areFriends } from '../friends.js'
import { assertRoomEditor, routeAuthError } from '../route-auth.js'

export async function registerRoomCoreRoutes(app: FastifyInstance) {
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
  const { name, description, memberIds, agents, sceneId, workgroupId } = request.body as any

  if (!name) {
    return reply.code(400).send({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Room name is required' }
    })
  }

  try {
    const targetWorkgroupId = workgroupId ? String(workgroupId) : undefined
    if (targetWorkgroupId) workgroupService.assertUserInWorkgroup(targetWorkgroupId, user.id)
    const initialMemberIds = Array.isArray(memberIds)
      ? memberIds.filter((id: string) => {
        if (!id || id === user.id) return false
        if (areFriends(user.id, id)) return true
        if (!targetWorkgroupId) return false
        try { workgroupService.assertUserInWorkgroup(targetWorkgroupId, id); return true } catch { return false }
      })
      : []
    // When a scene is selected, scene application is the single source of default Agents/pages.
    // Ignore client-selected agents to avoid cloning scene Agents twice from stale/cached clients.
    const initialAgents = sceneId ? [] : (Array.isArray(agents) ? agents : [])
    if (sceneId) sceneTemplateService.ensureBuiltInScenes(user.id)
    if (sceneId && !marketEngagementService.canUseScene(user, String(sceneId))) return reply.code(403).send({ success: false, error: { code: 'SCENE_NOT_PURCHASED', message: '请先购买或选择已拥有的场景' } })
    const sceneProvidesAssistant = sceneId ? sceneTemplateService.sceneHasAssistant(String(sceneId)) : false
    const room = await roomService.createRoom(name, description || null, user.id, initialMemberIds, [], { skipDefaultAssistant: sceneProvidesAssistant, roomKind: 'group', workgroupId: targetWorkgroupId })
    try {
      if (sceneId) await sceneTemplateService.applySceneToRoom(String(sceneId), room.id, user.id)
      if (!sceneId) {
        for (const agent of initialAgents) {
          if (!agent?.agentId) continue
          await agentService.addAgentToRoom(room.id, String(agent.agentId), user.id, {
            roomRole: agent.roomRole === 'assistant' ? 'assistant' : 'specialist',
            autoEnabled: agent.autoEnabled === true,
            priority: Number(agent.priority || 0),
            confirmedPurchase: agent.confirmedPurchase === true,
          })
        }
      }
      await agentService.refreshRoomAgentContext(room.id).catch(() => {})
      return reply.send({ success: true, data: { room } })
    } catch (err) {
      await roomService.deleteRoom(room.id, user.id).catch(() => {})
      throw err
    }
  } catch (err: any) {
    if (err.code === 'PURCHASE_CONFIRMATION_REQUIRED') return reply.code(409).send({ success: false, error: { code: err.code, message: err.message, priceCredits: err.priceCredits } })
    if (err.code === 'INSUFFICIENT_CREDITS') return reply.code(402).send({ success: false, error: { code: err.code, message: err.message } })
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
  const user = (request as any).user
  const { id } = request.params as any
  const { name, description } = request.body as any

  try {
    assertRoomEditor(id, user.id)
    const room = await roomService.updateRoom(id, name, description)
    return reply.send({ success: true, data: { room } })
  } catch (err: any) {
    if (err.code === 'NOT_ROOM_MEMBER' || err.code === 'FORBIDDEN') return routeAuthError(reply, err)
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

}
