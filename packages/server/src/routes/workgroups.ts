import { FastifyInstance } from 'fastify'
import { workgroupService } from '../services/workgroup.service.js'

function routeError(reply: any, err: any) {
  if (['WORKGROUP_NOT_FOUND', 'USER_NOT_FOUND', 'AGENT_NOT_FOUND', 'ENTRY_NOT_FOUND', 'ENTRY_EXPIRED'].includes(err.code)) return reply.code(404).send({ success: false, error: err })
  if (err.code === 'WORKGROUP_FORBIDDEN') return reply.code(403).send({ success: false, error: err })
  if (err.code === 'VALIDATION_ERROR') return reply.code(400).send({ success: false, error: err })
  if (err.code === 'INSUFFICIENT_CREDITS') return reply.code(402).send({ success: false, error: err })
  throw err
}

export async function registerWorkgroupRoutes(app: FastifyInstance) {
  app.get('/api/workgroups', async (request, reply) => {
    const user = (request as any).user
    return reply.send({ success: true, data: { workgroups: workgroupService.listForUser(user.id) } })
  })

  app.post('/api/workgroups', async (request, reply) => {
    const user = (request as any).user
    try { return reply.send({ success: true, data: workgroupService.createWorkgroup(user.id, request.body as any) }) }
    catch (err: any) { return routeError(reply, err) }
  })

  app.get('/api/workgroup-entries/:token', async (request, reply) => {
    const user = (request as any).user
    const { token } = request.params as any
    const { ref } = request.query as any
    try { return reply.send({ success: true, data: { entry: workgroupService.getEntryByToken(token, ref, user?.id) } }) }
    catch (err: any) { return routeError(reply, err) }
  })

  app.post('/api/workgroup-entries/:token/join', async (request, reply) => {
    const user = (request as any).user
    const { token } = request.params as any
    const { ref } = request.query as any
    try { return reply.send({ success: true, data: await workgroupService.joinEntry(token, user.id, ref) }) }
    catch (err: any) { return routeError(reply, err) }
  })

  app.get('/api/workgroups/:id', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try { return reply.send({ success: true, data: workgroupService.getOverview(id, user.id) }) }
    catch (err: any) { return routeError(reply, err) }
  })

  app.patch('/api/workgroups/:id', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try { return reply.send({ success: true, data: workgroupService.updateWorkgroup(id, user.id, request.body as any) }) }
    catch (err: any) { return routeError(reply, err) }
  })

  app.post('/api/workgroups/:id/members', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    try {
      workgroupService.assertCanManage(id, user.id)
      workgroupService.addMember(id, body.userId || body.id, body.role || 'member')
      return reply.send({ success: true, data: workgroupService.getOverview(id, user.id) })
    } catch (err: any) { return routeError(reply, err) }
  })

  app.patch('/api/workgroups/:id/members/:userId', async (request, reply) => {
    const user = (request as any).user
    const { id, userId } = request.params as any
    const body = request.body as any
    try {
      workgroupService.assertCanManage(id, user.id)
      workgroupService.updateMember(id, userId, body.role || 'member')
      return reply.send({ success: true, data: workgroupService.getOverview(id, user.id) })
    } catch (err: any) { return routeError(reply, err) }
  })

  app.delete('/api/workgroups/:id/members/:userId', async (request, reply) => {
    const user = (request as any).user
    const { id, userId } = request.params as any
    try {
      workgroupService.assertCanManage(id, user.id)
      workgroupService.removeMember(id, userId)
      return reply.send({ success: true, data: workgroupService.getOverview(id, user.id) })
    } catch (err: any) { return routeError(reply, err) }
  })

  app.get('/api/workgroups/:id/available-agents', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try { return reply.send({ success: true, data: { agents: workgroupService.listAvailableAgents(id, user.id) } }) }
    catch (err: any) { return routeError(reply, err) }
  })

  app.post('/api/workgroups/:id/agents', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    try {
      workgroupService.assertCanManage(id, user.id)
      workgroupService.addAgent(id, body.agentId || body.id, body.role || 'member')
      return reply.send({ success: true, data: workgroupService.getOverview(id, user.id) })
    } catch (err: any) { return routeError(reply, err) }
  })

  app.patch('/api/workgroups/:id/agents/:agentId', async (request, reply) => {
    const user = (request as any).user
    const { id, agentId } = request.params as any
    try {
      workgroupService.assertCanManage(id, user.id)
      workgroupService.updateAgent(id, agentId, request.body as any)
      return reply.send({ success: true, data: workgroupService.getOverview(id, user.id) })
    } catch (err: any) { return routeError(reply, err) }
  })

  app.delete('/api/workgroups/:id/agents/:agentId', async (request, reply) => {
    const user = (request as any).user
    const { id, agentId } = request.params as any
    try {
      workgroupService.assertCanManage(id, user.id)
      workgroupService.removeAgent(id, agentId)
      return reply.send({ success: true, data: workgroupService.getOverview(id, user.id) })
    } catch (err: any) { return routeError(reply, err) }
  })

  app.get('/api/workgroups/:id/entries', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try {
      workgroupService.assertUserInWorkgroup(id, user.id)
      return reply.send({ success: true, data: { entries: workgroupService.listEntries(id, user.id) } })
    } catch (err: any) { return routeError(reply, err) }
  })

  app.get('/api/workgroups/:id/entries/:entryId/analytics', async (request, reply) => {
    const user = (request as any).user
    const { id, entryId } = request.params as any
    try { return reply.send({ success: true, data: workgroupService.getEntryAnalytics(id, entryId, user.id) }) }
    catch (err: any) { return routeError(reply, err) }
  })

  app.post('/api/workgroups/:id/entries', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try { return reply.code(201).send({ success: true, data: { entry: workgroupService.createEntry(id, user.id, request.body as any) } }) }
    catch (err: any) { return routeError(reply, err) }
  })

  app.patch('/api/workgroups/:id/entries/:entryId', async (request, reply) => {
    const user = (request as any).user
    const { id, entryId } = request.params as any
    try { return reply.send({ success: true, data: { entry: workgroupService.updateEntry(id, entryId, user.id, request.body as any) } }) }
    catch (err: any) { return routeError(reply, err) }
  })

  app.delete('/api/workgroups/:id/entries/:entryId', async (request, reply) => {
    const user = (request as any).user
    const { id, entryId } = request.params as any
    try {
      workgroupService.deleteEntry(id, entryId, user.id)
      return reply.send({ success: true, data: { entries: workgroupService.listEntries(id, user.id) } })
    } catch (err: any) { return routeError(reply, err) }
  })
}
