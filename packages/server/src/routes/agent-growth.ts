import { FastifyInstance } from 'fastify'
import { roomService } from '../services/room.service.js'
import { agentGrowthService } from '../services/agent-growth.service.js'
import { assertRoomEditor, routeAuthError } from './route-auth.js'

async function assertRoomMember(roomId: string, userId: string, reply: any) {
  const isMember = await roomService.isMember(roomId, userId)
  if (!isMember) {
    reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    return false
  }
  return true
}

export async function registerAgentGrowthRoutes(app: FastifyInstance) {
  app.get('/api/rooms/:roomId/agent-growth', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    if (!(await assertRoomMember(roomId, user.id, reply))) return
    return reply.send({ success: true, data: agentGrowthService.listGrowth(roomId) })
  })

  app.post('/api/rooms/:roomId/agent-growth/run', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    const body = request.body as any || {}
    try {
      assertRoomEditor(roomId, user.id)
      agentGrowthService.runGrowthReview({ roomId, date: body.date })
      return reply.send({ success: true, data: agentGrowthService.listGrowth(roomId) })
    } catch (err: any) {
      return routeAuthError(reply, err)
    }
  })

  app.post('/api/agent-growth/proposals/:id/accept', async (request, reply) => {
    try {
      const user = (request as any).user
      const { id } = request.params as any
      const roomId = agentGrowthService.getProposalRoomId(id)
      assertRoomEditor(roomId, user.id)
      const memory = agentGrowthService.acceptProposal(id)
      return reply.send({ success: true, data: { memory } })
    } catch (err: any) {
      if (err.code === 'PROPOSAL_NOT_FOUND') return reply.code(404).send({ success: false, error: err })
      if (err.code === 'NOT_ROOM_MEMBER' || err.code === 'FORBIDDEN') return routeAuthError(reply, err)
      throw err
    }
  })

  app.post('/api/agent-growth/proposals/:id/reject', async (request, reply) => {
    try {
      const user = (request as any).user
      const { id } = request.params as any
      const roomId = agentGrowthService.getProposalRoomId(id)
      assertRoomEditor(roomId, user.id)
      return reply.send({ success: true, data: agentGrowthService.rejectProposal(id) })
    } catch (err: any) {
      if (err.code === 'PROPOSAL_NOT_FOUND') return reply.code(404).send({ success: false, error: err })
      if (err.code === 'NOT_ROOM_MEMBER' || err.code === 'FORBIDDEN') return routeAuthError(reply, err)
      throw err
    }
  })

  app.delete('/api/agent-growth/memories/:id', async (request, reply) => {
    try {
      const user = (request as any).user
      const { id } = request.params as any
      const roomId = agentGrowthService.getMemoryRoomId(id)
      assertRoomEditor(roomId, user.id)
      return reply.send({ success: true, data: agentGrowthService.deleteMemory(id) })
    } catch (err: any) {
      if (err.code === 'MEMORY_NOT_FOUND') return reply.code(404).send({ success: false, error: err })
      if (err.code === 'NOT_ROOM_MEMBER' || err.code === 'FORBIDDEN') return routeAuthError(reply, err)
      throw err
    }
  })
}
