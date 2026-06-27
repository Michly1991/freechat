import { FastifyInstance } from 'fastify'
import { agentService } from '../../services/agent.service.js'
import { templatePermissionService } from '../../services/template-permission.service.js'

export async function registerAgentPermissionRoutes(app: FastifyInstance) {
app.get('/api/agents/:id/permissions', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  await agentService.getAgent(id)
  const canManage = !agentService.isLockedBuiltInAgent(id) && templatePermissionService.canManage('agent', id, user)
  const members = canManage ? templatePermissionService.listMembers('agent', id) : []
  const requests = canManage ? templatePermissionService.listRequestsForTarget('agent', id) : []
  return reply.send({ success: true, data: { canManage, members, requests } })
})

app.post('/api/agents/:id/permissions', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  const body = request.body as any
  if (!String(body?.userId || '').trim()) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'userId is required' } })
  agentService.assertAgentMutable(id)
  const members = templatePermissionService.grant('agent', id, user, String(body.userId), body.role || 'editor')
  return reply.send({ success: true, data: { members } })
})

app.delete('/api/agents/:id/permissions/:userId', async (request, reply) => {
  const user = (request as any).user
  const { id, userId } = request.params as any
  agentService.assertAgentMutable(id)
  const members = templatePermissionService.revoke('agent', id, user, userId)
  return reply.send({ success: true, data: { members } })
})

app.post('/api/agents/:id/permission-requests', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  const body = request.body as any
  agentService.assertAgentMutable(id)
  const requestRow = templatePermissionService.request('agent', id, user.id, body?.message, body?.role || 'editor')
  return reply.code(201).send({ success: true, data: { request: requestRow } })
})

app.post('/api/agents/:id/permission-requests/:requestId/resolve', async (request, reply) => {
  const user = (request as any).user
  const { requestId } = request.params as any
  const body = request.body as any
  const decision = body?.decision === 'reject' ? 'reject' : 'approve'
  const requestRow = templatePermissionService.resolveRequest(requestId, user, decision)
  return reply.send({ success: true, data: { request: requestRow } })
})

}
