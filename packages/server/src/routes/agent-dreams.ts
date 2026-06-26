import { FastifyInstance } from 'fastify'
import { agentDreamService } from '../services/agent-dream.service.js'
import { assertRoomEditor, assertRoomMember, requireAdmin, routeAuthError } from './route-auth.js'
import db from '../storage/db.js'

function assertDreamReadable(id: string, user: any) {
  const row = db.prepare('SELECT room_id FROM agent_dreams WHERE id = ?').get(id) as any
  if (!row) throw { code: 'DREAM_NOT_FOUND', message: 'Dream not found' }
  if (user.role !== 'admin') assertRoomMember(row.room_id, user.id)
}

export async function registerAgentDreamRoutes(app: FastifyInstance) {
  app.get('/api/agent-dreams', async (request, reply) => {
    const user = (request as any).user
    const q = request.query as any
    try {
      if (q.roomId) assertRoomMember(q.roomId, user.id)
      else requireAdmin(user)
      return { success: true, data: { dreams: agentDreamService.listDreams(q.roomId, Number(q.limit || 50)) } }
    } catch (err: any) { return routeAuthError(reply, err) }
  })

  app.post('/api/agent-dreams/run', async (request, reply) => {
    const user = (request as any).user
    const body = request.body as any || {}
    try {
      if (body.roomId) assertRoomEditor(body.roomId, user.id)
      else requireAdmin(user)
      const dreams = agentDreamService.runDreams({ date: body.date, roomId: body.roomId, agentId: body.agentId, dryRun: body.dryRun === true })
      return { success: true, data: { dreams } }
    } catch (err: any) { return routeAuthError(reply, err) }
  })

  app.get('/api/agent-dreams/:id', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try {
      assertDreamReadable(id, user)
      return { success: true, data: { dream: agentDreamService.getDream(id) } }
    } catch (err: any) { return routeAuthError(reply, err) }
  })
}
