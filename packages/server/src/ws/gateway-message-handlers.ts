import { v4 as uuidv4 } from 'uuid'
import { messageService } from '../services/message.service.js'
import { agentStreamService } from '../services/agent-stream.service.js'
import { notificationService } from '../services/notification.service.js'
import { roomService } from '../services/room.service.js'
import type { ClientConnection, InvokeReason } from './gateway-types.js'

export type GatewayHandlerContext = {
  getClient: (clientId: string) => ClientConnection | undefined
  leaveRoom: (clientId: string, roomId: string) => void
  joinRoom: (clientId: string, roomId: string) => Promise<void>
  sendToClient: (clientId: string, message: any) => void
  broadcastToRoom: (roomId: string, message: any, excludeClientId?: string) => void
  maybeAutoInvokeAssistant: (roomId: string, actorName: string, content: string, mentions?: any[], actorUserId?: string) => Promise<any>
  invokeMentionedAgents: (roomId: string, content: string, mentions: any[], reason?: InvokeReason, actorUserId?: string) => Promise<any>
}

export type GatewayActionHandler = (clientId: string, message: any) => Promise<void> | void

export function createGatewayActionHandlers(ctx: GatewayHandlerContext): Record<string, GatewayActionHandler> {
  const currentRoomClient = (clientId: string) => {
    const client = ctx.getClient(clientId)
    return client?.currentRoomId ? client : null
  }

  return {
    'room.join': async (clientId, message) => {
      await ctx.joinRoom(clientId, message.payload?.room_id)
    },
    'room.leave': (clientId) => {
      const client = ctx.getClient(clientId)
      if (client?.currentRoomId) ctx.leaveRoom(clientId, client.currentRoomId)
    },
    'chat.send': async (clientId, message) => {
      const client = currentRoomClient(clientId)
      if (!client) return
      await handleChatSend(ctx, client, message.payload || {})
    },
    'chat.history': async (clientId, message) => {
      const client = currentRoomClient(clientId)
      if (!client) return
      await handleChatHistory(ctx, clientId, client, message.payload || {})
    },
    'chat.edit': async (clientId, message) => {
      const client = currentRoomClient(clientId)
      if (!client) return
      await handleChatEdit(ctx, client, message.payload || {})
    },
    'chat.delete': async (clientId, message) => {
      const client = currentRoomClient(clientId)
      if (!client) return
      await handleChatDelete(ctx, client, message.payload || {})
    },
    'chat.typing': (clientId) => {
      const client = currentRoomClient(clientId)
      if (!client) return
      ctx.broadcastToRoom(client.currentRoomId!, {
        msgId: uuidv4(),
        roomId: client.currentRoomId!,
        type: 'broadcast',
        action: 'chat.typing_update',
        payload: { userId: client.userId, username: client.nickname, typing: true },
        timestamp: Date.now(),
      }, clientId)
    },
  }
}

async function handleChatSend(ctx: GatewayHandlerContext, client: ClientConnection, payload: any) {
  const roomId = client.currentRoomId!
  const msg = await messageService.createMessage(roomId, client.userId, client.nickname, client.role, payload.content, payload.mentions, payload.reply_to)

  ctx.broadcastToRoom(roomId, {
    msgId: msg.id,
    roomId,
    type: 'broadcast',
    action: 'chat.message',
    payload: msg,
    timestamp: Date.now(),
  })

  runUserMessageSideEffects(ctx, roomId, client.userId, client.nickname, client.role, msg.id, payload.content, payload.mentions || [])
}

async function handleChatHistory(ctx: GatewayHandlerContext, clientId: string, client: ClientConnection, payload: any) {
  const roomId = client.currentRoomId!
  const page = await messageService.getMessagesPage(roomId, payload.limit || 100, payload.before)
  const activeStreams = payload.before ? [] : agentStreamService.getActiveStreamMessages(roomId)
  const messages = [...page.messages, ...activeStreams].sort((a: any, b: any) => (a.createdAt || 0) - (b.createdAt || 0))

  ctx.sendToClient(clientId, {
    msgId: uuidv4(),
    roomId,
    type: 'api_response',
    action: 'chat.history_result',
    payload: { messages, hasMore: page.hasMore, before: payload.before || null },
    timestamp: Date.now(),
  })
}

async function handleChatEdit(ctx: GatewayHandlerContext, client: ClientConnection, payload: any) {
  const roomId = client.currentRoomId!
  const msg = await messageService.updateMessageAsUser(payload.message_id, roomId, { id: client.userId, role: client.userRole }, payload.content)
  ctx.broadcastToRoom(roomId, { msgId: uuidv4(), roomId, type: 'broadcast', action: 'chat.edited', payload: msg, timestamp: Date.now() })
}

async function handleChatDelete(ctx: GatewayHandlerContext, client: ClientConnection, payload: any) {
  const roomId = client.currentRoomId!
  await messageService.deleteMessageAsUser(payload.message_id, roomId, { id: client.userId, role: client.userRole })
  ctx.broadcastToRoom(roomId, { msgId: uuidv4(), roomId, type: 'broadcast', action: 'chat.deleted', payload: { message_id: payload.message_id }, timestamp: Date.now() })
}

export function runUserMessageSideEffects(ctx: Pick<GatewayHandlerContext, 'maybeAutoInvokeAssistant' | 'invokeMentionedAgents'>, roomId: string, userId: string, actorName: string, actorRole: string, messageId: string, content: string, mentions: any[] = []) {
  notificationService.notifyMentions({ roomId, messageId, actorId: userId, actorName, content, mentions })
  const agentMentions = mentions.filter((m: any) => m?.role === 'ai' && m?.id)
  if ((actorRole === 'human' || actorRole === 'user' || actorRole === 'admin') && agentMentions.length > 0) {
    void ctx.invokeMentionedAgents(roomId, content, mentions, 'mention', userId)
  } else if (actorRole === 'human' || actorRole === 'user' || actorRole === 'admin') {
    void ctx.maybeAutoInvokeAssistant(roomId, actorName, content, mentions, userId)
  }
}

export async function assertCanJoinRoom(roomId: string, userId: string) {
  const isMember = await roomService.isMember(roomId, userId)
  if (!isMember) throw { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' }
}
