import { FastifyInstance } from 'fastify'
import { roomService } from '../services/room.service.js'
import { roomAnalyticsService } from '../services/room-analytics.service.js'

async function assertRoomMember(roomId: string, userId: string, reply: any) {
  const isMember = await roomService.isMember(roomId, userId)
  if (!isMember) {
    reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    return false
  }
  return true
}

export async function registerRoomAnalyticsRoutes(app: FastifyInstance) {
  app.get('/api/rooms/:roomId/analytics', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    if (!(await assertRoomMember(roomId, user.id, reply))) return
    const overview = roomAnalyticsService.getOverview(roomId, request.query as any)
    return reply.send({ success: true, data: overview })
  })

  app.get('/api/rooms/:roomId/analytics/runs', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    if (!(await assertRoomMember(roomId, user.id, reply))) return
    const runs = roomAnalyticsService.getRuns(roomId, request.query as any)
    return reply.send({ success: true, data: runs })
  })

  app.get('/api/rooms/:roomId/analytics/runs/:runId', async (request, reply) => {
    const user = (request as any).user
    const { roomId, runId } = request.params as any
    if (!(await assertRoomMember(roomId, user.id, reply))) return
    try {
      const detail = roomAnalyticsService.getRunDetail(roomId, runId)
      return reply.send({ success: true, data: detail })
    } catch (err: any) {
      if (err.code === 'RUN_NOT_FOUND') return reply.code(404).send({ success: false, error: err })
      throw err
    }
  })
}
