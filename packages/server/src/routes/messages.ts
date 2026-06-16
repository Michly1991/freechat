import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { messageService } from '../services/message.service.js'
import { roomService } from '../services/room.service.js'
import { getGateway } from '../ws/gateway.js'
import { notificationService } from '../services/notification.service.js'

export async function registerMessageRoutes(app: FastifyInstance) {
  app.get('/api/rooms/:roomId/messages', async (request, reply) => {
    const { roomId } = request.params as any
    const { limit = '100', before } = request.query as any
    const user = (request as any).user

    if (!(await roomService.isMember(roomId, user.id))) {
      return reply.code(403).send({ success: false, error: { message: 'You are not a member of this room' } })
    }

    const page = await messageService.getMessagesPage(roomId, Number(limit) || 100, before)
    return { success: true, data: page }
  })

  app.post('/api/rooms/:roomId/messages', async (request, reply) => {
    const { roomId } = request.params as any
    const user = (request as any).user
    const body = request.body as any
    const content = String(body?.content || '').trim()

    if (!content) {
      return reply.code(400).send({ success: false, error: { message: '消息不能为空' } })
    }

    if (!(await roomService.isMember(roomId, user.id))) {
      return reply.code(403).send({ success: false, error: { message: 'You are not a member of this room' } })
    }

    const gateway = getGateway()
    const msg = gateway
      ? await gateway.sendRoomMessage(roomId, user, body)
      : await messageService.createMessage(
          roomId,
          user.id,
          user.nickname || user.username,
          user.role === 'agent' ? 'ai' : 'human',
          content,
          body.mentions,
          body.reply_to
        )

    if (!gateway) {
      getGateway()?.broadcast(roomId, {
        msgId: uuidv4(),
        roomId,
        type: 'broadcast',
        action: 'chat.message',
        payload: msg,
        timestamp: Date.now()
      })
      notificationService.notifyMentions({
        roomId,
        messageId: msg.id,
        actorId: user.id,
        actorName: user.nickname || user.username,
        content,
        mentions: body.mentions,
      })
    }

    return { success: true, data: { message: msg } }
  })
}
