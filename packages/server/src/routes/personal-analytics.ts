import { FastifyInstance } from 'fastify'
import { personalAnalyticsService } from '../services/personal-analytics.service.js'

export async function registerPersonalAnalyticsRoutes(app: FastifyInstance) {
  app.get('/api/me/analytics', async (request, reply) => {
    const user = (request as any).user
    const data = personalAnalyticsService.getOverview(user.id, request.query as any)
    return reply.send({ success: true, data })
  })

  app.get('/api/me/analytics/runs', async (request, reply) => {
    const user = (request as any).user
    const data = personalAnalyticsService.getRuns(user.id, request.query as any)
    return reply.send({ success: true, data })
  })

  app.get('/api/me/analytics/runs/:runId', async (request, reply) => {
    const user = (request as any).user
    const { runId } = request.params as any
    try {
      const data = personalAnalyticsService.getRunDetail(user.id, runId)
      return reply.send({ success: true, data })
    } catch (err: any) {
      if (err.code === 'RUN_NOT_FOUND') return reply.code(404).send({ success: false, error: err })
      throw err
    }
  })
}
