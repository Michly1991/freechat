import { FastifyInstance } from 'fastify'
import { sceneTemplateService } from '../services/scene-template.service.js'
import { templatePermissionService } from '../services/template-permission.service.js'
import { marketEngagementService } from '../services/market-engagement.service.js'

export async function registerSceneRoutes(app: FastifyInstance) {
  app.get('/api/scenes', async (request, reply) => {
    const user = (request as any).user
    const scenes = sceneTemplateService.listScenes(user)
    return reply.send({ success: true, data: { scenes } })
  })

  app.post('/api/scenes', async (request, reply) => {
    const body = request.body as any
    if (!String(body?.name || '').trim()) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } })
    }
    const user = (request as any).user
    const scene = sceneTemplateService.createScene(user.id, {
      name: body.name,
      description: body.description,
      icon: body.icon,
      agents: body.agents,
    })
    return reply.send({ success: true, data: { scene } })
  })

  app.get('/api/scenes/:id/permissions', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const canManage = templatePermissionService.canManage('scene', id, user)
    const members = canManage ? templatePermissionService.listMembers('scene', id) : []
    const requests = canManage ? templatePermissionService.listRequestsForTarget('scene', id) : []
    return reply.send({ success: true, data: { canManage, members, requests } })
  })

  app.post('/api/scenes/:id/permissions', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    if (!String(body?.userId || '').trim()) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'userId is required' } })
    const members = templatePermissionService.grant('scene', id, user, String(body.userId), body.role || 'editor')
    return reply.send({ success: true, data: { members } })
  })

  app.delete('/api/scenes/:id/permissions/:userId', async (request, reply) => {
    const user = (request as any).user
    const { id, userId } = request.params as any
    const members = templatePermissionService.revoke('scene', id, user, userId)
    return reply.send({ success: true, data: { members } })
  })

  app.post('/api/scenes/:id/permission-requests', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    const requestRow = templatePermissionService.request('scene', id, user.id, body?.message, body?.role || 'editor')
    return reply.code(201).send({ success: true, data: { request: requestRow } })
  })

  app.post('/api/scenes/:id/permission-requests/:requestId/resolve', async (request, reply) => {
    const user = (request as any).user
    const { requestId } = request.params as any
    const body = request.body as any
    const decision = body?.decision === 'reject' ? 'reject' : 'approve'
    const requestRow = templatePermissionService.resolveRequest(requestId, user, decision)
    return reply.send({ success: true, data: { request: requestRow } })
  })

  app.post('/api/scenes/:id/purchase', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try {
      const body = request.body as any
      const result = marketEngagementService.purchaseScene(user, id, body?.confirmed === true)
      const scene = sceneTemplateService.hydrateScene(sceneTemplateService.getSceneRecord(id), user)
      return reply.send({ success: true, data: { ...result, scene } })
    } catch (err: any) {
      if (err.code === 'SCENE_NOT_FOUND') return reply.code(404).send({ success: false, error: err })
      if (err.code === 'PURCHASE_CONFIRMATION_REQUIRED') return reply.code(409).send({ success: false, error: { code: err.code, message: err.message, priceCredits: err.priceCredits } })
      if (err.code === 'INSUFFICIENT_CREDITS') return reply.code(402).send({ success: false, error: err })
      throw err
    }
  })

  app.put('/api/scenes/:id/billing-rule', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try {
      const scene = sceneTemplateService.upsertBillingRule(user, id, request.body as any)
      return reply.send({ success: true, data: { scene } })
    } catch (err: any) {
      const status = err.code === 'SCENE_NOT_FOUND' ? 404 : (err.code === 'FORBIDDEN' ? 403 : 400)
      return reply.code(status).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.patch('/api/scenes/:id', async (request, reply) => {
    const { id } = request.params as any
    const body = request.body as any
    if (body?.name !== undefined && !String(body.name).trim()) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } })
    }
    const user = (request as any).user
    const scene = sceneTemplateService.updateScene(user, id, {
      name: body.name,
      description: body.description,
      icon: body.icon,
      agents: body.agents,
      marketListed: body.marketListed,
    })
    return reply.send({ success: true, data: { scene } })
  })
}
