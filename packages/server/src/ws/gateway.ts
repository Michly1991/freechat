import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { v4 as uuidv4 } from 'uuid'
import { verifyToken } from '../auth/jwt.js'
import { messageService } from '../services/message.service.js'
import { roomService } from '../services/room.service.js'
import { agentService } from '../services/agent.service.js'
import { agentRestartService } from '../services/agent-restart.service.js'
import { AgentInvocationHandler } from './agent-invocation.js'
import { TaskHandler } from './task-handlers.js'
import type { ClientConnection, InvokeReason } from './gateway-types.js'

export class WebSocketGateway {
  private wss: WebSocketServer
  private clients: Map<string, ClientConnection> = new Map()
  private roomClients: Map<string, Set<string>> = new Map() // roomId -> Set<clientId>
  private agentInvocation: AgentInvocationHandler
  private taskHandler: TaskHandler

  constructor(server: Server) {
    this.agentInvocation = new AgentInvocationHandler((roomId, message, excludeClientId) => this.broadcastToRoom(roomId, message, excludeClientId))
    this.taskHandler = new TaskHandler(
      (clientId) => this.clients.get(clientId),
      (roomId, message, excludeClientId) => this.broadcastToRoom(roomId, message, excludeClientId),
      (roomId, content, mentions, reason) => this.invokeMentionedAgents(roomId, content, mentions, reason)
    )
    this.wss = new WebSocketServer({ server, path: '/ws' })
    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req))
    console.log('✓ WebSocket gateway initialized')
  }

  private handleConnection(ws: WebSocket, req: any) {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const token = url.searchParams.get('token')

    if (!token) {
      ws.close(4001, 'No token provided')
      return
    }

    const decoded = verifyToken(token)
    if (!decoded) {
      ws.close(4001, 'Invalid token')
      return
    }

    const clientId = uuidv4()
    const client: ClientConnection = {
      ws,
      userId: decoded.id,
      username: decoded.username,
      nickname: decoded.nickname,
      role: decoded.role === 'agent' ? 'ai' : 'human'
    }

    this.clients.set(clientId, client)

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString())
        this.handleMessage(clientId, message)
      } catch (err) {
        this.sendToClient(clientId, {
          msgId: uuidv4(),
          roomId: '',
          type: 'api_response',
          action: 'error',
          payload: { error: 'Invalid JSON' },
          timestamp: Date.now()
        })
      }
    })

    ws.on('close', () => {
      if (client.currentRoomId) {
        this.leaveRoom(clientId, client.currentRoomId)
      }
      this.clients.delete(clientId)
    })

    ws.on('error', () => {
      this.clients.delete(clientId)
    })

    // Send welcome
    this.sendToClient(clientId, {
      msgId: uuidv4(),
      roomId: '',
      type: 'system',
      action: 'connected',
      payload: { userId: decoded.id, username: decoded.username },
      timestamp: Date.now()
    })
  }

  private async handleMessage(clientId: string, message: any) {
    const client = this.clients.get(clientId)
    if (!client) return

    const { action, payload, roomId } = message

    try {
      switch (action) {
        case 'room.join':
          await this.joinRoom(clientId, payload.room_id)
          break
        case 'room.leave':
          if (client.currentRoomId) {
            this.leaveRoom(clientId, client.currentRoomId)
          }
          break
        case 'chat.send':
          await this.handleChatSend(clientId, payload)
          break
        case 'chat.history':
          await this.handleChatHistory(clientId, payload)
          break
        case 'chat.edit':
          await this.handleChatEdit(clientId, payload)
          break
        case 'chat.delete':
          await this.handleChatDelete(clientId, payload)
          break
        case 'chat.typing':
          this.broadcastToRoom(client.currentRoomId!, {
            msgId: uuidv4(),
            roomId: client.currentRoomId!,
            type: 'broadcast',
            action: 'chat.typing_update',
            payload: { userId: client.userId, username: client.nickname, typing: true },
            timestamp: Date.now()
          }, clientId)
          break
        case 'task.list':
          await this.taskHandler.handleTaskList(clientId, payload)
          break
        case 'task.add':
        case 'task.create':
          await this.taskHandler.handleTaskAdd(clientId, payload)
          break
        case 'task.update':
          await this.taskHandler.handleTaskUpdate(clientId, payload)
          break
        case 'task.progress':
          await this.taskHandler.handleTaskProgress(clientId, payload)
          break
        case 'task.delete':
          await this.taskHandler.handleTaskDelete(clientId, payload)
          break
        case 'task.retry':
          await this.taskHandler.handleTaskRetry(clientId, payload)
          break
        case 'task.subtask.add':
        case 'task.subtask_add':
          await this.taskHandler.handleTaskSubtaskAdd(clientId, payload)
          break
        case 'task.subtask.update':
        case 'task.subtask_update':
          await this.taskHandler.handleTaskSubtaskUpdate(clientId, payload)
          break
        case 'task.subtask.retry':
        case 'task.subtask_retry':
          await this.taskHandler.handleTaskSubtaskRetry(clientId, payload)
          break
        case 'task.subtask.delete':
        case 'task.subtask_delete':
          await this.taskHandler.handleTaskSubtaskDelete(clientId, payload)
          break
        case 'agent.restart':
          await this.handleAgentRestart(clientId, payload)
          break
        default:
          this.sendToClient(clientId, {
            msgId: uuidv4(),
            roomId: roomId || '',
            type: 'api_response',
            action: 'error',
            payload: { error: `Unknown action: ${action}` },
            timestamp: Date.now()
          })
      }
    } catch (err: any) {
      this.sendToClient(clientId, {
        msgId: uuidv4(),
        roomId: roomId || '',
        type: 'api_response',
        action: 'error',
        payload: { code: err.code || 'INTERNAL_ERROR', message: err.message || 'Internal error' },
        timestamp: Date.now()
      })
    }
  }

  private async handleAgentRestart(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return
    const agentId = payload.agentId || payload.agent_id || payload.id || payload.name
    if (!agentId) throw { code: 'VALIDATION_ERROR', message: 'agentId is required' }
    if (!(await agentService.canEditRoomAgents(client.currentRoomId, client.userId))) throw { code: 'FORBIDDEN', message: 'Only room owner/editor can restart agents' }
    const result = await agentRestartService.softRestart(client.currentRoomId, agentId, client.userId, payload.clearSession !== false)
    this.broadcastToRoom(client.currentRoomId, {
      msgId: uuidv4(),
      roomId: client.currentRoomId,
      type: 'broadcast',
      action: 'agent.status_update',
      payload: { agentId: result.agent.id, status: 'active', onlineStatus: 'online', lastActiveAt: Date.now(), lastError: null },
      timestamp: Date.now()
    })
    if (result.pendingSubtasks.length > 0) {
      const lines = result.pendingSubtasks.map((item: any, i: number) => `${i + 1}. 父任务 ${item.task_id}「${item.task_title}」 / 子任务 ${item.id}「${item.title}」`).join('\n')
      void this.invokeMentionedAgents(client.currentRoomId, `你刚刚被人工软恢复，请继续处理已分派但未完成的子任务：\n${lines}\n\n请先用 ./freechat task subtask update 标记状态/进展，完成后在聊天中简短汇报。`, [{ id: result.agent.id, name: result.agent.name, role: 'ai' }], 'task')
    }
  }

  private async joinRoom(clientId: string, roomId: string) {
    const client = this.clients.get(clientId)
    if (!client) return

    // Leave current room first
    if (client.currentRoomId) {
      this.leaveRoom(clientId, client.currentRoomId)
    }

    // Check membership
    const isMember = await roomService.isMember(roomId, client.userId)
    if (!isMember) {
      this.sendToClient(clientId, {
        msgId: uuidv4(),
        roomId,
        type: 'api_response',
        action: 'error',
        payload: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' },
        timestamp: Date.now()
      })
      return
    }

    client.currentRoomId = roomId

    if (!this.roomClients.has(roomId)) {
      this.roomClients.set(roomId, new Set())
    }
    this.roomClients.get(roomId)!.add(clientId)

    // Send success response
    this.sendToClient(clientId, {
      msgId: uuidv4(),
      roomId,
      type: 'api_response',
      action: 'room.joined',
      payload: { success: true },
      timestamp: Date.now()
    })

    // Broadcast member joined
    this.broadcastToRoom(roomId, {
      msgId: uuidv4(),
      roomId,
      type: 'system',
      action: 'room.member_join',
      payload: {
        actor: { id: client.userId, name: client.nickname, role: client.role }
      },
      timestamp: Date.now()
    })

    // Send current online members
    this.sendOnlineMembers(clientId, roomId)
  }

  private leaveRoom(clientId: string, roomId: string) {
    const client = this.clients.get(clientId)
    if (!client) return

    client.currentRoomId = undefined
    this.roomClients.get(roomId)?.delete(clientId)

    // Broadcast member left
    this.broadcastToRoom(roomId, {
      msgId: uuidv4(),
      roomId,
      type: 'system',
      action: 'room.member_leave',
      payload: {
        actor: { id: client.userId, name: client.nickname, role: client.role }
      },
      timestamp: Date.now()
    })
  }

  private async handleChatSend(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return

    const msg = await messageService.createMessage(
      client.currentRoomId,
      client.userId,
      client.nickname,
      client.role,
      payload.content,
      payload.mentions,
      payload.reply_to
    )

    // Broadcast to all in room
    this.broadcastToRoom(client.currentRoomId, {
      msgId: msg.id,
      roomId: client.currentRoomId,
      type: 'broadcast',
      action: 'chat.message',
      payload: msg,
      timestamp: Date.now()
    })

    const mentions = payload.mentions || []
    const agentMentions = mentions.filter((m: any) => m?.role === 'ai' && m?.id)
    if (client.role === 'human' && agentMentions.length > 0) {
      void this.invokeMentionedAgents(client.currentRoomId, payload.content, mentions)
    } else if (client.role === 'human') {
      void this.maybeAutoInvokeAssistant(client.currentRoomId, client.nickname, payload.content, mentions)
    }
  }

  private async maybeAutoInvokeAssistant(roomId: string, actorName: string, content: string, mentions: any[] = []) {
    return this.agentInvocation.maybeAutoInvokeAssistant(roomId, actorName, content, mentions)
  }

  private async invokeMentionedAgents(roomId: string, content: string, mentions: any[], reason: InvokeReason = 'mention') {
    return this.agentInvocation.invokeMentionedAgents(roomId, content, mentions, reason)
  }

  private async handleChatHistory(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return

    const messages = await messageService.getMessages(
      client.currentRoomId,
      payload.limit || 100,
      payload.before
    )

    this.sendToClient(clientId, {
      msgId: uuidv4(),
      roomId: client.currentRoomId,
      type: 'api_response',
      action: 'chat.history_result',
      payload: { messages },
      timestamp: Date.now()
    })
  }

  private async handleChatEdit(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return

    const msg = await messageService.updateMessage(payload.message_id, payload.content)

    this.broadcastToRoom(client.currentRoomId, {
      msgId: uuidv4(),
      roomId: client.currentRoomId,
      type: 'broadcast',
      action: 'chat.edited',
      payload: msg,
      timestamp: Date.now()
    })
  }

  private async handleChatDelete(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return

    await messageService.deleteMessage(payload.message_id)

    this.broadcastToRoom(client.currentRoomId, {
      msgId: uuidv4(),
      roomId: client.currentRoomId,
      type: 'broadcast',
      action: 'chat.deleted',
      payload: { message_id: payload.message_id },
      timestamp: Date.now()
    })
  }

  private sendOnlineMembers(clientId: string, roomId: string) {
    const members: any[] = []
    const roomClientIds = this.roomClients.get(roomId) || new Set()

    for (const cid of roomClientIds) {
      const c = this.clients.get(cid)
      if (c) {
        members.push({ id: c.userId, name: c.nickname, role: c.role })
      }
    }

    this.sendToClient(clientId, {
      msgId: uuidv4(),
      roomId,
      type: 'system',
      action: 'room.online_update',
      payload: { members },
      timestamp: Date.now()
    })
  }

  private sendToClient(clientId: string, message: any) {
    const client = this.clients.get(clientId)
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message))
    }
  }

  private broadcastToRoom(roomId: string, message: any, excludeClientId?: string) {
    const roomClientIds = this.roomClients.get(roomId)
    if (!roomClientIds) return

    const data = JSON.stringify(message)
    for (const clientId of roomClientIds) {
      if (clientId !== excludeClientId) {
        const client = this.clients.get(clientId)
        if (client && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(data)
        }
      }
    }
  }

  // Public method for services/routes to broadcast messages
  broadcast(roomId: string, message: any) {
    this.broadcastToRoom(roomId, message)
  }

  async sendRoomMessage(roomId: string, user: any, payload: any) {
    const msg = await messageService.createMessage(
      roomId,
      user.id,
      user.nickname || user.username,
      user.role === 'agent' ? 'ai' : 'human',
      payload.content,
      payload.mentions,
      payload.reply_to
    )

    this.broadcastToRoom(roomId, {
      msgId: msg.id,
      roomId,
      type: 'broadcast',
      action: 'chat.message',
      payload: msg,
      timestamp: Date.now()
    })

    const mentions = payload.mentions || []
    const agentMentions = mentions.filter((m: any) => m?.role === 'ai' && m?.id)
    if ((user.role === 'user' || user.role === 'admin') && agentMentions.length > 0) {
      void this.invokeMentionedAgents(roomId, payload.content, mentions)
    } else if ((user.role === 'user' || user.role === 'admin')) {
      void this.maybeAutoInvokeAssistant(roomId, user.nickname || user.username, payload.content, mentions)
    }

    return msg
  }
}

let gateway: WebSocketGateway | null = null

export function initWebSocket(server: Server): WebSocketGateway {
  gateway = new WebSocketGateway(server)
  return gateway
}

export function getGateway(): WebSocketGateway | null {
  return gateway
}

export const getWebSocketGateway = getGateway
