import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { v4 as uuidv4 } from 'uuid'
import { verifyToken } from '../auth/jwt.js'
import { messageService } from '../services/message.service.js'
import { taskService } from '../services/task.service.js'
import { roomService } from '../services/room.service.js'
import { agentService } from '../services/agent.service.js'

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
  private assistantAutoReplyCooldowns: Map<string, number> = new Map() // roomId -> timestamp

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

    const mentions = payload.mentions || []
    const agentMentions = mentions.filter((m: any) => m?.role === 'ai' && m?.id)
    if (agentMentions.length > 0) {
      void this.invokeMentionedAgents(client.currentRoomId, payload.content, mentions)
    } else if (client.role === 'human') {
      void this.maybeAutoInvokeAssistant(client.currentRoomId, client.nickname, payload.content)
    }
  }

  private shouldConsiderAssistantAutoReply(content: string): boolean {
    const text = content.trim()
    if (!text) return false
    if (text.length <= 2) return false
    if (/^(好|好的|收到|嗯|哦|哈哈|呵呵|ok|OK|1|测试|谢谢|谢了)[。.!！?？]*$/.test(text)) return false
    return /[?？]|帮我|怎么|如何|为什么|下一步|总结|安排|任务|卡住|阻塞|方案|决定|谁来|能不能|可以吗|咋办|处理|实现|优化|修复|设计|评估|建议/.test(text)
  }

  private async maybeAutoInvokeAssistant(roomId: string, actorName: string, content: string) {
    if (!this.shouldConsiderAssistantAutoReply(content)) return

    const now = Date.now()
    const last = this.assistantAutoReplyCooldowns.get(roomId) || 0
    const cooldownMs = 30_000
    if (now - last < cooldownMs) return

    const roomAgents = await agentService.getRoomAgents(roomId)
    const assistant = roomAgents.find((a: any) => a.roleType === 'assistant' && a.status !== 'inactive')
    if (!assistant) return

    this.assistantAutoReplyCooldowns.set(roomId, now)

    const recentMessages = await messageService.getMessages(roomId, 10)
    const context = recentMessages
      .map((m) => `${m.actorRole === 'ai' ? 'AI' : '用户'} ${m.actorName}: ${m.content}`)
      .join('\n')

    const prompt = `你是 FreeChat 房间助理，正在旁听项目对话。\n\n最近对话：\n${context}\n\n最新消息来自 ${actorName}: ${content}\n\n请判断是否需要你介入回复。\n- 如果只是闲聊、确认、测试、无意义短消息，或者人类成员可以自然继续，不要回复，只输出 [SILENT]。\n- 如果用户在提问、寻求方案、任务推进、总结、安排、阻塞处理、决策建议，才回复。\n- 如需推进项目，请优先使用 ./freechat CLI 同步任务/进度/文件。\n- 回复要简洁，不要抢话。`

    await this.invokeMentionedAgents(roomId, prompt, [{ id: assistant.id, name: assistant.name, role: 'ai' }])
  }

  private async invokeMentionedAgents(roomId: string, content: string, mentions: any[]) {
    const agentMentions = mentions.filter((m) => m?.role === 'ai' && m?.id)
    if (agentMentions.length === 0) return

    const uniqueAgentIds = Array.from(new Set(agentMentions.map((m) => m.id)))
    const roomAgents = await agentService.getRoomAgents(roomId)
    const roomAgentIds = new Set(roomAgents.map((a) => a.id))

    for (const agentId of uniqueAgentIds) {
      if (!roomAgentIds.has(agentId)) continue
      const agent = roomAgents.find((a) => a.id === agentId)
      if (!agent) continue

      this.broadcastToRoom(roomId, {
        msgId: uuidv4(),
        roomId,
        type: 'broadcast',
        action: 'agent.status_update',
        payload: { agentId, status: 'working' },
        timestamp: Date.now()
      })

      try {
        await agentService.updateAgent(agentId, { status: 'working' } as any)
        const result = await agentService.spawnClaudeCode(roomId, agentId, content)
        await agentService.updateAgent(agentId, { status: 'active' } as any)

        this.broadcastToRoom(roomId, {
          msgId: uuidv4(),
          roomId,
          type: 'broadcast',
          action: 'agent.status_update',
          payload: { agentId, status: 'active' },
          timestamp: Date.now()
        })

        if (result.silent || !result.response) continue

        const responseMsg = await messageService.createMessage(
          roomId,
          agentId,
          agent.name,
          'ai',
          result.response
        )

        this.broadcastToRoom(roomId, {
          msgId: responseMsg.id,
          roomId,
          type: 'broadcast',
          action: 'chat.message',
          payload: responseMsg,
          timestamp: Date.now()
        })
      } catch (err: any) {
        await agentService.updateAgent(agentId, { status: 'active' } as any).catch(() => {})
        this.broadcastToRoom(roomId, {
          msgId: uuidv4(),
          roomId,
          type: 'broadcast',
          action: 'agent.status_update',
          payload: { agentId, status: 'active' },
          timestamp: Date.now()
        })
        console.error(`Agent ${agentId} invocation failed:`, err)
      }
    }
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
