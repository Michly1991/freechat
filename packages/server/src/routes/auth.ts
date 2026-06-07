import { FastifyInstance } from 'fastify'
import { authService } from '../services/auth.service.js'

export async function registerAuthRoutes(app: FastifyInstance) {
  // Register
  app.post('/api/auth/register', async (request, reply) => {
    const { username, password, nickname } = request.body as any

    if (!username || !password || !nickname) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Username, password, and nickname are required' }
      })
    }

    try {
      const result = await authService.register(username, password, nickname)
      return reply.send({ success: true, data: result })
    } catch (err: any) {
      if (err.code === 'USERNAME_TAKEN') {
        return reply.code(409).send({ success: false, error: err })
      }
      throw err
    }
  })

  // Login
  app.post('/api/auth/login', async (request, reply) => {
    const { username, password } = request.body as any

    if (!username || !password) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Username and password are required' }
      })
    }

    try {
      const result = await authService.login(username, password)
      return reply.send({ success: true, data: result })
    } catch (err: any) {
      if (err.code === 'INVALID_PASSWORD') {
        return reply.code(401).send({ success: false, error: err })
      }
      throw err
    }
  })

  // Get current user
  app.get('/api/auth/me', async (request, reply) => {
    const user = (request as any).user
    if (!user) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } })
    }

    try {
      const result = await authService.getMe(user.id)
      return reply.send({ success: true, data: result })
    } catch (err: any) {
      throw err
    }
  })

  // Update profile
  app.patch('/api/user/profile', async (request, reply) => {
    const user = (request as any).user
    const { nickname, avatar } = request.body as any

    try {
      const result = await authService.updateProfile(user.id, nickname, avatar)
      return reply.send({ success: true, data: result })
    } catch (err: any) {
      throw err
    }
  })

  // Change password
  app.post('/api/user/password', async (request, reply) => {
    const user = (request as any).user
    const { old_password, new_password } = request.body as any

    if (!old_password || !new_password) {
      return reply.code(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Old and new password are required' }
      })
    }

    try {
      await authService.changePassword(user.id, old_password, new_password)
      return reply.send({ success: true })
    } catch (err: any) {
      if (err.code === 'INVALID_PASSWORD') {
        return reply.code(401).send({ success: false, error: err })
      }
      throw err
    }
  })
}
