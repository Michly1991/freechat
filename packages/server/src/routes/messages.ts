import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { messageService } from '../services/message.service.js'
import { roomFileService } from '../services/room-file.service.js'
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

  app.post('/api/rooms/:roomId/messages/with-files', async (request, reply) => {
    const { roomId } = request.params as any
    const user = (request as any).user
    if (!(await roomService.isMember(roomId, user.id))) {
      return reply.code(403).send({ success: false, error: { message: 'You are not a member of this room' } })
    }
    try {
      const parts = request.parts()
      const messageId = `msg_${uuidv4()}`
      let content = ''
      const attachments: any[] = []
      for await (const part of parts) {
        if (part.type === 'file') attachments.push(await roomFileService.createMessageAttachment(roomId, messageId, part, user.id))
        else if (part.fieldname === 'content') content = String(part.value || '').trim()
      }
      if (!content && attachments.length === 0) return reply.code(400).send({ success: false, error: { message: '消息不能为空' } })
      const payload = attachments.length ? { attachments } : undefined
      const msg = await messageService.createMessage(roomId, user.id, user.nickname || user.username, user.role === 'agent' ? 'ai' : 'human', content || '[附件]', undefined, undefined, 'text', payload, messageId)
      const gateway = getGateway()
      gateway?.broadcast(roomId, { msgId: msg.id, roomId, type: 'broadcast', action: 'chat.message', payload: msg, timestamp: Date.now() })
      const attachmentHint = attachments.length ? `\n\n本次消息附件：\n${attachments.map((file) => `- ref: ${file.ref}; fileId: ${file.id}; folderId: ${file.folderId}; path: ${file.relativePath}; name: ${file.name}; type: ${file.mimeType || 'unknown'}; size: ${file.size}`).join('\n')}\n请用 ./freechat file download file:<fileId> 下载后处理；不同房间文件不可见，禁止跨房间访问。` : ''
      gateway?.handleUserMessageSideEffects(roomId, user, msg, `${content || '[附件]'}${attachmentHint}`, [])
      return { success: true, data: { message: msg } }
    } catch (err: any) {
      return reply.code(err?.code === 'INVALID_PATH' ? 400 : 500).send({ success: false, error: { message: err.message || String(err) } })
    }
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
