import { FastifyInstance } from 'fastify'
import { authService } from '../services/auth.service.js'
import { config } from '../config.js'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

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

  // Upload avatar
  app.post('/api/user/avatar', async (request, reply) => {
    const user = (request as any).user

    try {
      const file = await request.file()
      if (!file) {
        return reply.code(400).send({
          success: false,
          error: { code: 'NO_FILE', message: '请选择头像图片' }
        })
      }

      const allowedTypes: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif'
      }
      const ext = allowedTypes[file.mimetype]
      if (!ext) {
        return reply.code(400).send({
          success: false,
          error: { code: 'INVALID_FILE_TYPE', message: '头像只支持 png、jpg、webp、gif 图片' }
        })
      }

      const buffer = await file.toBuffer()
      if (buffer.length > 2 * 1024 * 1024) {
        return reply.code(400).send({
          success: false,
          error: { code: 'FILE_TOO_LARGE', message: '头像图片不能超过 2MB' }
        })
      }

      const dir = join(config.upload.dir, 'avatars')
      await mkdir(dir, { recursive: true })
      const filename = `${user.id}-${Date.now()}.${ext}`
      const filepath = join(dir, filename)
      await writeFile(filepath, buffer)

      const avatar = `/uploads/avatars/${filename}`
      const updated = await authService.updateProfile(user.id, undefined, avatar)
      return reply.send({ success: true, data: { user: updated, avatar } })
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
