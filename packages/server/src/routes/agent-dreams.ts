import { FastifyInstance } from 'fastify'
import { agentDreamService } from '../services/agent-dream.service.js'

export async function registerAgentDreamRoutes(app: FastifyInstance) {
  app.get('/api/agent-dreams', async (request) => {
    const q = request.query as any
    return { success: true, data: { dreams: agentDreamService.listDreams(q.roomId, Number(q.limit || 50)) } }
  })

  app.post('/api/agent-dreams/run', async (request) => {
    const body = request.body as any || {}
    const dreams = agentDreamService.runDreams({ date: body.date, roomId: body.roomId, agentId: body.agentId, dryRun: body.dryRun === true })
    return { success: true, data: { dreams } }
  })

  app.get('/api/agent-dreams/:id', async (request) => {
    const { id } = request.params as any
    return { success: true, data: { dream: agentDreamService.getDream(id) } }
  })
}
