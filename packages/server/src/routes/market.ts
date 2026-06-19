import { FastifyInstance } from 'fastify'
import { marketEngagementService } from '../services/market-engagement.service.js'

export async function registerMarketRoutes(app: FastifyInstance) {
  app.post('/api/market/follows', async (request, reply) => {
    const user = (request as any).user
    const body = request.body as any
    try {
      const result = marketEngagementService.follow(user.id, body?.targetType, String(body?.targetId || ''))
      return reply.send({ success: true, data: result })
    } catch (err: any) {
      if (err.code === 'VALIDATION_ERROR') return reply.code(400).send({ success: false, error: err })
      if (err.code === 'NOT_FOUND') return reply.code(404).send({ success: false, error: err })
      throw err
    }
  })

  app.delete('/api/market/follows/:targetType/:targetId', async (request, reply) => {
    const user = (request as any).user
    const { targetType, targetId } = request.params as any
    const result = marketEngagementService.unfollow(user.id, targetType, targetId)
    return reply.send({ success: true, data: result })
  })
}
