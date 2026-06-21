import { FastifyInstance } from 'fastify'
import { knowledgeService } from '../services/knowledge.service.js'

export async function registerKnowledgeRoutes(app: FastifyInstance) {
  app.get('/api/knowledge', async (request, reply) => {
    const user = (request as any).user
    const query = request.query as any
    const entries = await knowledgeService.list(user, query)
    return reply.send({ success: true, data: { entries } })
  })

  app.post('/api/knowledge', async (request, reply) => {
    const user = (request as any).user
    const entry = await knowledgeService.create(user, request.body as any)
    return reply.send({ success: true, data: { entry } })
  })

  app.patch('/api/knowledge/:id', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const entry = await knowledgeService.update(user, id, request.body as any)
    return reply.send({ success: true, data: { entry } })
  })

  app.delete('/api/knowledge/:id', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    await knowledgeService.remove(user, id)
    return reply.send({ success: true })
  })
}
