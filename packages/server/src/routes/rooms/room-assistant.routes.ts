import { FastifyInstance } from 'fastify'
import { roomService } from '../../services/room.service.js'
import { roomAssistantService } from '../../services/room-assistant.service.js'

export async function registerRoomAssistantRoutes(app: FastifyInstance) {
app.post('/api/rooms/:id/assistant/handoff', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  const { agentId, reason } = request.body as any
  if (!(await roomService.isMember(id, user.id))) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
  const result = await roomAssistantService.requestHandoff({ roomId: id, targetAgentId: String(agentId || ''), requestedBy: user.id, requestedByType: 'human', reason, source: 'web', policy: 'auto', wake: true })
  return reply.send({ success: true, data: result })
})

}
