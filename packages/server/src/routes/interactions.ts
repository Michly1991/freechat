import { FastifyInstance } from 'fastify'
import { interactionService } from '../services/interaction.service.js'
import { roomService } from '../services/room.service.js'
import { getGateway } from '../ws/gateway.js'

function broadcast(roomId: string, action: string, payload: any) {
  getGateway()?.broadcast(roomId, {
    msgId: `${action}_${Date.now()}`,
    roomId,
    type: 'broadcast',
    action,
    payload,
    timestamp: Date.now(),
  })
}

export async function registerInteractionRoutes(app: FastifyInstance) {
  app.get('/api/rooms/:roomId/interactions', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    const query = request.query as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    const interactions = interactionService.list(roomId, { status: query.status, targetUserId: query.target === 'me' ? user.id : undefined })
    return reply.send({ success: true, data: { interactions } })
  })

  app.post('/api/rooms/:roomId/interactions', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    const body = request.body as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    try {
      const result = await interactionService.create(roomId, { id: user.id, name: user.nickname || user.username, role: 'human' }, body)
      broadcast(roomId, 'chat.message', result.message)
      broadcast(roomId, 'interaction.created', { interaction: result.interaction })
      return reply.send({ success: true, data: result })
    } catch (err: any) {
      return reply.code(400).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.get('/api/rooms/:roomId/interactions/:id', async (request, reply) => {
    const user = (request as any).user
    const { roomId, id } = request.params as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    try {
      return reply.send({ success: true, data: { interaction: interactionService.get(roomId, id) } })
    } catch (err: any) {
      return reply.code(err.code === 'INTERACTION_NOT_FOUND' ? 404 : 400).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.patch('/api/rooms/:roomId/interactions/:id/respond', async (request, reply) => {
    const user = (request as any).user
    const { roomId, id } = request.params as any
    const body = request.body as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    try {
      const interaction = interactionService.respond(roomId, id, user.id, body.value ?? body.values, body.inputs || {})
      broadcast(roomId, 'interaction.updated', { interaction })
      return reply.send({ success: true, data: { interaction } })
    } catch (err: any) {
      const status = err.code === 'INTERACTION_NOT_FOUND' ? 404 : (err.code === 'FORBIDDEN' ? 403 : 400)
      return reply.code(status).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.post('/api/rooms/:roomId/interactions/:id/respond', async (request, reply) => {
    const user = (request as any).user
    const { roomId, id } = request.params as any
    const body = request.body as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    try {
      const interaction = interactionService.respond(roomId, id, user.id, body.value ?? body.values, body.inputs || {})
      broadcast(roomId, 'interaction.updated', { interaction })
      return reply.send({ success: true, data: { interaction } })
    } catch (err: any) {
      const status = err.code === 'INTERACTION_NOT_FOUND' ? 404 : (err.code === 'FORBIDDEN' ? 403 : 400)
      return reply.code(status).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.post('/api/rooms/:roomId/interactions/:id/consume', async (request, reply) => {
    const user = (request as any).user
    const { roomId, id } = request.params as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    try {
      const interaction = interactionService.consume(roomId, id, user.id)
      broadcast(roomId, 'interaction.updated', { interaction })
      return reply.send({ success: true, data: { interaction } })
    } catch (err: any) {
      return reply.code(err.code === 'INTERACTION_NOT_FOUND' ? 404 : 400).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.post('/api/rooms/:roomId/interactions/:id/cancel', async (request, reply) => {
    const user = (request as any).user
    const { roomId, id } = request.params as any
    if (!await roomService.isMember(roomId, user.id)) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }
    try {
      const interaction = interactionService.cancel(roomId, id, user.id)
      broadcast(roomId, 'interaction.updated', { interaction })
      return reply.send({ success: true, data: { interaction } })
    } catch (err: any) {
      const status = err.code === 'INTERACTION_NOT_FOUND' ? 404 : (err.code === 'FORBIDDEN' ? 403 : 400)
      return reply.code(status).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })
}
