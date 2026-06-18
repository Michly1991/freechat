import { FastifyInstance } from 'fastify'
import { modelProfileService } from '../services/model-profile.service.js'

export async function registerModelProfileRoutes(app: FastifyInstance) {
  app.get('/api/model-profiles', async (request, reply) => {
    const user = (request as any).user
    const profiles = modelProfileService.listVisible(user.id, user.role)
    return reply.send({ success: true, data: { profiles } })
  })

  app.post('/api/model-profiles', async (request, reply) => {
    const user = (request as any).user
    const body = request.body as any
    if (!String(body?.name || '').trim()) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } })
    const profile = modelProfileService.create(user.id, body)
    return reply.code(201).send({ success: true, data: { profile } })
  })

  app.patch('/api/model-profiles/:id', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try {
      const profile = modelProfileService.update(user, id, request.body as any)
      return reply.send({ success: true, data: { profile } })
    } catch (err: any) {
      if (err.code === 'MODEL_PROFILE_NOT_FOUND') return reply.code(404).send({ success: false, error: err })
      if (err.code === 'FORBIDDEN') return reply.code(403).send({ success: false, error: err })
      throw err
    }
  })
}
