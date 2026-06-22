import { FastifyInstance } from 'fastify'
import { workgroupService } from '../services/workgroup.service.js'

export async function registerWorkgroupRoutes(app: FastifyInstance) {
  app.get('/api/workgroups', async (request, reply) => {
    const user = (request as any).user
    return reply.send({ success: true, data: { workgroups: workgroupService.listForUser(user.id) } })
  })

  app.post('/api/workgroups', async (request, reply) => {
    const user = (request as any).user
    try {
      const data = workgroupService.createWorkgroup(user.id, request.body as any)
      return reply.send({ success: true, data })
    } catch (err: any) {
      if (err.code === 'VALIDATION_ERROR') return reply.code(400).send({ success: false, error: err })
      throw err
    }
  })

  app.get('/api/workgroups/:id', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try {
      return reply.send({ success: true, data: workgroupService.getOverview(id, user.id) })
    } catch (err: any) {
      if (err.code === 'WORKGROUP_NOT_FOUND') return reply.code(404).send({ success: false, error: err })
      if (err.code === 'WORKGROUP_FORBIDDEN') return reply.code(403).send({ success: false, error: err })
      throw err
    }
  })

  app.patch('/api/workgroups/:id', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try {
      return reply.send({ success: true, data: workgroupService.updateWorkgroup(id, user.id, request.body as any) })
    } catch (err: any) {
      if (err.code === 'WORKGROUP_NOT_FOUND') return reply.code(404).send({ success: false, error: err })
      if (err.code === 'WORKGROUP_FORBIDDEN') return reply.code(403).send({ success: false, error: err })
      if (err.code === 'VALIDATION_ERROR') return reply.code(400).send({ success: false, error: err })
      throw err
    }
  })

  app.post('/api/workgroups/:id/members', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    try {
      workgroupService.assertCanManage(id, user.id)
      workgroupService.addMember(id, body.userId || body.id, body.role || 'member')
      return reply.send({ success: true, data: workgroupService.getOverview(id, user.id) })
    } catch (err: any) {
      if (['WORKGROUP_NOT_FOUND', 'USER_NOT_FOUND'].includes(err.code)) return reply.code(404).send({ success: false, error: err })
      if (err.code === 'WORKGROUP_FORBIDDEN') return reply.code(403).send({ success: false, error: err })
      throw err
    }
  })

  app.post('/api/workgroups/:id/agents', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    try {
      workgroupService.assertCanManage(id, user.id)
      workgroupService.addAgent(id, body.agentId || body.id, body.role || 'member')
      return reply.send({ success: true, data: workgroupService.getOverview(id, user.id) })
    } catch (err: any) {
      if (['WORKGROUP_NOT_FOUND', 'AGENT_NOT_FOUND'].includes(err.code)) return reply.code(404).send({ success: false, error: err })
      if (err.code === 'WORKGROUP_FORBIDDEN') return reply.code(403).send({ success: false, error: err })
      throw err
    }
  })
}
