import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { v4 as uuidv4 } from 'uuid'
import { verifyToken } from '../auth/jwt.js'
import { messageService } from '../services/message.service.js'
import { taskService } from '../services/task.service.js'
import { roomService } from '../services/room.service.js'

interface ClientConnection {
  ws: WebSocket
  userId: string
  username: string
  nickname: string
  role: 'human' | 'ai'
  currentRoomId?: string
}

export class WebSocketGateway {
  private wss: WebSocketServer
  private clients: Map<string, ClientConnection> = new Map()
  private roomClients: Map<string, Set<string>> = new Map() // roomId -> Set<clientId>

  constructor(server: Server) {
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
          await this.handleTaskList(clientId, payload)
          break
        case 'task.add':
          await this.handleTaskAdd(clientId, payload)
          break
        case 'task.update':
          await this.handleTaskUpdate(clientId, payload)
          break
        case 'task.delete':
          await this.handleTaskDelete(clientId, payload)
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
  }

  private async handleChatHistory(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return

    const messages = await messageService.getMessages(
      client.currentRoomId,
      payload.limit || 50,
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

  private async handleTaskList(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return

    const tasks = await taskService.getRoomTasks(client.currentRoomId, payload.status)

    this.sendToClient(clientId, {
      msgId: uuidv4(),
      roomId: client.currentRoomId,
      type: 'api_response',
      action: 'task.list_result',
      payload: { tasks },
      timestamp: Date.now()
    })
  }

  private async handleTaskAdd(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return

    const task = await taskService.createTask(
      client.currentRoomId,
      payload.title,
      payload.description,
      payload.priority,
      payload.assignee_id,
      payload.assignee_name,
      payload.assignee_type,
      client.userId
    )

    this.broadcastToRoom(client.currentRoomId, {
      msgId: uuidv4(),
      roomId: client.currentRoomId,
      type: 'broadcast',
      action: 'task.changed',
      payload: { action: 'add', task },
      timestamp: Date.now()
    })
  }

  private async handleTaskUpdate(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return

    const task = await taskService.updateTask(payload.task_id, payload.updates)

    this.broadcastToRoom(client.currentRoomId, {
      msgId: uuidv4(),
      roomId: client.currentRoomId,
      type: 'broadcast',
      action: 'task.changed',
      payload: { action: 'update', task },
      timestamp: Date.now()
    })
  }

  private async handleTaskDelete(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return

    await taskService.deleteTask(payload.task_id)

    this.broadcastToRoom(client.currentRoomId, {
      msgId: uuidv4(),
      roomId: client.currentRoomId,
      type: 'broadcast',
      action: 'task.changed',
      payload: { action: 'delete', task_id: payload.task_id },
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
      action: 'room.members_update',
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

  // Public method for services to broadcast messages
  broadcast(roomId: string, message: any) {
    this.broadcastToRoom(roomId, message)
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
