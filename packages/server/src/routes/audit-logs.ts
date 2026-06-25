import { FastifyInstance } from 'fastify'
import { auditLogService } from '../services/audit-log.service.js'

export async function registerAuditLogRoutes(app: FastifyInstance) {
  app.get('/api/audit/logs', async (request, reply) => {
    const user = (request as any).user
    if (user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: '仅管理员可查看审计日志' } })
    }

    const query = request.query as any
    const limit = Math.min(200, Number(query.limit || 50))
    const offset = Number(query.offset || 0)

    const logs = auditLogService.list({
      userId: query.userId || undefined,
      action: query.action || undefined,
      targetType: query.targetType || undefined,
      targetId: query.targetId || undefined,
      limit,
      offset,
    })

    const total = auditLogService.count({
      userId: query.userId || undefined,
      action: query.action || undefined,
      targetType: query.targetType || undefined,
      targetId: query.targetId || undefined,
    })

    return reply.send({
      success: true,
      data: { logs, total, limit, offset },
    })
  })

  app.get('/api/audit/stats', async (request, reply) => {
    const user = (request as any).user
    if (user.role !== 'admin') {
      return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: '仅管理员可查看审计统计' } })
    }

    const logs = auditLogService.list({ limit: 1000 })
    const actionCounts: Record<string, number> = {}
    logs.forEach((log) => {
      actionCounts[log.action] = (actionCounts[log.action] || 0) + 1
    })

    const last24h = logs.filter((log) => Date.now() - log.createdAt < 24 * 60 * 60 * 1000).length

    return reply.send({
      success: true,
      data: { total: logs.length, last24h, actionCounts },
    })
  })
}
