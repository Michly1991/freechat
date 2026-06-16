import { FastifyInstance } from 'fastify'
import { notificationService } from '../services/notification.service.js'

export async function registerNotificationRoutes(app: FastifyInstance) {
  app.get('/api/notifications', async (request, reply) => {
    const user = (request as any).user
    const { limit = '30', unreadOnly = 'false' } = request.query as any
    const data = notificationService.list(user.id, Number(limit) || 30, unreadOnly === 'true')
    return reply.send({ success: true, data })
  })

  app.post('/api/notifications/read', async (request, reply) => {
    const user = (request as any).user
    const body = (request.body || {}) as any
    const data = body.all ? notificationService.markAllRead(user.id) : notificationService.markRead(user.id, Array.isArray(body.ids) ? body.ids : [])
    return reply.send({ success: true, data })
  })
}
