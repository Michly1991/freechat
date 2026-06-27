import { FastifyInstance } from 'fastify'
import { roomService } from '../../services/room.service.js'
import { routeAuthError } from '../route-auth.js'
import { assertCanRemoveRoomMember } from '../../utils/room-authz.js'

export async function registerRoomLeaveRoutes(app: FastifyInstance) {
  app.post('/api/rooms/:id/leave', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any

    try {
      assertCanRemoveRoomMember(id, user.id, user.id)
      await roomService.removeMember(id, user.id)
      return reply.send({ success: true })
    } catch (err: any) {
      if (err.code === 'NOT_ROOM_MEMBER' || err.code === 'FORBIDDEN' || err.code === 'LAST_OWNER_REQUIRED') return routeAuthError(reply, err)
      throw err
    }
  })
}
