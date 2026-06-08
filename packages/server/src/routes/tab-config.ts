import { FastifyInstance } from 'fastify'
import { roomService } from '../services/room.service.js'
import { tabConfigService } from '../services/tab-config.service.js'

export async function registerTabConfigRoutes(app: FastifyInstance) {
  app.get('/api/rooms/:roomId/tab-config/:tabKey', async (request, reply) => {
    const user = (request as any).user
    const { roomId, tabKey } = request.params as any
    const isMember = await roomService.isMember(roomId, user.id)
    if (!isMember) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }

    const tab = await tabConfigService.getTab(roomId, tabKey)
    return reply.send({ success: true, data: { tab } })
  })

  app.post('/api/rooms/:roomId/tab-config/:tabKey/files', async (request, reply) => {
    const user = (request as any).user
    const { roomId, tabKey } = request.params as any
    const { path } = request.body as any
    const isMember = await roomService.isMember(roomId, user.id)
    if (!isMember) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }

    try {
      const tab = await tabConfigService.addFile(roomId, tabKey, path)
      return reply.send({ success: true, data: { tab } })
    } catch (err: any) {
      return reply.code(400).send({ success: false, error: { code: err.code || 'INVALID_PATH', message: err.message || String(err) } })
    }
  })

  app.delete('/api/rooms/:roomId/tab-config/:tabKey/files', async (request, reply) => {
    const user = (request as any).user
    const { roomId, tabKey } = request.params as any
    const { path } = request.body as any
    const isMember = await roomService.isMember(roomId, user.id)
    if (!isMember) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }

    try {
      const tab = await tabConfigService.removeFile(roomId, tabKey, path)
      return reply.send({ success: true, data: { tab } })
    } catch (err: any) {
      return reply.code(400).send({ success: false, error: { code: err.code || 'INVALID_PATH', message: err.message || String(err) } })
    }
  })

  app.post('/api/rooms/:roomId/tab-config/:tabKey/dirs', async (request, reply) => {
    const user = (request as any).user
    const { roomId, tabKey } = request.params as any
    const { path } = request.body as any
    const isMember = await roomService.isMember(roomId, user.id)
    if (!isMember) {
      return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    }

    try {
      const tab = await tabConfigService.addDir(roomId, tabKey, path)
      return reply.send({ success: true, data: { tab } })
    } catch (err: any) {
      return reply.code(400).send({ success: false, error: { code: err.code || 'INVALID_PATH', message: err.message || String(err) } })
    }
  })
}
