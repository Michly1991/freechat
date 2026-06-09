import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'
import { v4 as uuidv4 } from 'uuid'
import { verifyToken } from '../auth/jwt.js'
import { messageService } from '../services/message.service.js'
import { taskService } from '../services/task.service.js'
import { taskItemService } from '../services/task-item.service.js'
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
        case 'task.create':
          await this.handleTaskAdd(clientId, payload)
          break
        case 'task.update':
          await this.handleTaskUpdate(clientId, payload)
          break
        case 'task.progress':
          await this.handleTaskProgress(clientId, payload)
          break
        case 'task.delete':
          await this.handleTaskDelete(clientId, payload)
          break
        case 'task.subtask.add':
        case 'task.subtask_add':
          await this.handleTaskSubtaskAdd(clientId, payload)
          break
        case 'task.subtask.update':
        case 'task.subtask_update':
          await this.handleTaskSubtaskUpdate(clientId, payload)
          break
        case 'task.subtask.delete':
        case 'task.subtask_delete':
          await this.handleTaskSubtaskDelete(clientId, payload)
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
    if (client.role === 'human' && agentMentions.length > 0) {
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
    // 只过滤明显无意义/确认类短消息。其余消息交给助理结合上下文判断是否 [SILENT]，避免规则过窄导致用户感觉“它不理我”。
    return true
  }

  private async maybeAutoInvokeAssistant(roomId: string, actorName: string, content: string) {
    if (!this.shouldConsiderAssistantAutoReply(content)) return

    const now = Date.now()
    const last = this.assistantAutoReplyCooldowns.get(roomId) || 0
    const cooldownMs = 30_000
    if (now - last < cooldownMs) return

    const assistant = await agentService.getAutoAgent(roomId)
    if (!assistant) return

    this.assistantAutoReplyCooldowns.set(roomId, now)

    const recentMessages = await messageService.getMessages(roomId, 12)
    const context = recentMessages
      .filter((m: any) => m.kind !== 'agent_receipt')
      .slice(-10)
      .map((m) => `${m.actorRole === 'ai' ? 'AI' : '用户'} ${m.actorName}: ${m.content}`)
      .join('\n')

    const prompt = `你是 FreeChat 房间助理，正在旁听项目对话。\n\n最近对话：\n${context}\n\n最新消息来自 ${actorName}: ${content}\n\n请判断是否需要你介入回复。\n- 如果只是闲聊、确认、测试、无意义短消息，或者人类成员可以自然继续，不要回复，只输出 [SILENT]。\n- 如果用户在提问、寻求方案、任务推进、总结、安排、阻塞处理、决策建议，才回复。\n- 用户没有明确 @ 专家时，系统只会触发你；不要让专家突然插话。\n- 你是入口和调度者：自己能高质量完成就自己做；如果当前房间有更合适的专家，应优先通过 ./freechat task subtask add / task update 等任务方式分派专家，而不是自己硬做。\n- 不要通过普通聊天 @ 专家制造自动对话。\n- 如需推进项目，请优先使用 ./freechat CLI 同步任务/进度/文件。\n- 回复要简洁，不要抢话。`

    await this.invokeMentionedAgents(roomId, prompt, [{ id: assistant.id, name: assistant.name, role: 'ai' }], 'auto')
  }

  private async sendAgentReceipt(roomId: string, agentId: string, agentName: string, reason: 'auto' | 'mention' | 'task' | 'manual' = 'mention') {
    const receiptMsg = await messageService.createMessage(
      roomId,
      agentId,
      agentName,
      'ai',
      '收到，处理中…',
      undefined,
      undefined,
      'agent_receipt',
      { status: 'accepted', reason }
    )

    this.broadcastToRoom(roomId, {
      msgId: receiptMsg.id,
      roomId,
      type: 'broadcast',
      action: 'chat.message',
      payload: receiptMsg,
      timestamp: Date.now()
    })
  }

  private async invokeMentionedAgents(roomId: string, content: string, mentions: any[], receiptReason: 'auto' | 'mention' | 'task' | 'manual' = 'mention') {
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
        payload: { agentId, status: 'working', onlineStatus: 'working', lastActiveAt: Date.now() },
        timestamp: Date.now()
      })

      try {
        await this.sendAgentReceipt(roomId, agentId, agent.name, receiptReason)
        await agentService.updateAgent(agentId, { status: 'working' } as any)
        const result = await agentService.spawnClaudeCode(roomId, agentId, content)
        await agentService.updateAgent(agentId, { status: 'active' } as any)

        this.broadcastToRoom(roomId, {
          msgId: uuidv4(),
          roomId,
          type: 'broadcast',
          action: 'agent.status_update',
          payload: { agentId, status: 'active', onlineStatus: 'online', lastActiveAt: Date.now() },
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
        await agentService.updateAgent(agentId, { status: 'error' } as any).catch(() => {})
        this.broadcastToRoom(roomId, {
          msgId: uuidv4(),
          roomId,
          type: 'broadcast',
          action: 'agent.status_update',
          payload: { agentId, status: 'error', onlineStatus: 'error', lastActiveAt: Date.now(), lastError: err?.message || String(err) },
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

    const title = String(payload.title || '').trim()
    if (!title) {
      throw { code: 'VALIDATION_ERROR', message: '任务标题不能为空' }
    }

    let assigneeId = payload.assignee_id || payload.assigneeId
    let assigneeName = payload.assignee_name || payload.assigneeName
    let assigneeType = payload.assignee_type || payload.assigneeType

    if (!assigneeId) {
      const roomAgents = await agentService.getRoomAgents(client.currentRoomId)
      const assistant = roomAgents.find((a: any) => a.roleType === 'assistant' && a.status !== 'inactive')
      if (assistant) {
        assigneeId = assistant.id
        assigneeName = assistant.name
        assigneeType = 'agent'
      }
    }

    const task = await taskService.createTask(
      client.currentRoomId,
      title,
      payload.description,
      payload.priority,
      assigneeId,
      assigneeName,
      assigneeType,
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

    if (client.role === 'human' && assigneeType === 'agent' && assigneeId) {
      const prompt = [
        '你是 FreeChat 房间助理，刚刚自动接管了一个新父任务。',
        '',
        `任务ID: ${task.id}`,
        `任务标题: ${task.title}`,
        task.description ? `任务说明: ${task.description}` : '',
        '',
        '请立即判断该任务如何处理：',
        '- 如果简单、单 Agent 可完成，不要再创建父任务，直接完成并在聊天中汇报。',
        '- 如果复杂、需要专门能力，或当前房间有更合适的专家 Agent，请优先使用 ./freechat task subtask add 拆分子任务并分派专家，不要自己硬做。',
        '- 不要通过普通聊天 @ 专家制造自动对话；专家应通过任务/子任务分派被唤醒。',
        '- 开始处理前可用 ./freechat task update 更新父任务状态，例如 status doing。',
        '- 接管后先用 ./freechat chat send 主动汇报。',
        '- 用 ./freechat task progress 写入最近进展，用户会在任务卡片看到。',
        '- 子任务状态要及时维护，父任务会汇总显示子任务状态。',
      ].filter(Boolean).join('\n')
      void this.invokeMentionedAgents(client.currentRoomId, prompt, [{ id: assigneeId, name: assigneeName || '助理', role: 'ai' }], 'task')
    }
  }

  private async handleTaskUpdate(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return

    const taskId = payload.task_id || payload.taskId || payload.id
    const updates = payload.updates || {
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      ...(payload.status !== undefined ? { status: payload.status } : {}),
      ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
      ...(payload.assigneeId !== undefined ? { assigneeId: payload.assigneeId } : {}),
      ...(payload.assigneeName !== undefined ? { assigneeName: payload.assigneeName } : {}),
      ...(payload.blockedReason !== undefined ? { blockedReason: payload.blockedReason } : {}),
      ...(payload.reviewNote !== undefined ? { reviewNote: payload.reviewNote } : {}),
      ...(payload.progressNote !== undefined ? { progressNote: payload.progressNote } : {}),
    }
    if (!taskId) {
      throw { code: 'VALIDATION_ERROR', message: 'task_id is required' }
    }

    await taskService.assertTaskInRoom(taskId, client.currentRoomId)
    const task = await taskService.updateTask(taskId, updates)

    this.broadcastToRoom(client.currentRoomId, {
      msgId: uuidv4(),
      roomId: client.currentRoomId,
      type: 'broadcast',
      action: 'task.changed',
      payload: { action: 'update', task },
      timestamp: Date.now()
    })
  }

  private async handleTaskProgress(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return
    const taskId = payload.task_id || payload.taskId || payload.id
    const note = String(payload.note || payload.progressNote || '').trim()
    if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'task_id is required' }
    if (!note) throw { code: 'VALIDATION_ERROR', message: 'progress note is required' }
    await taskService.assertTaskInRoom(taskId, client.currentRoomId)
    const task = await taskService.updateTask(taskId, { progressNote: note } as any)
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

    const taskId = payload.task_id || payload.taskId || payload.id
    if (!taskId) {
      throw { code: 'VALIDATION_ERROR', message: 'task_id is required' }
    }
    await taskService.assertTaskInRoom(taskId, client.currentRoomId)
    await taskService.deleteTask(taskId)

    this.broadcastToRoom(client.currentRoomId, {
      msgId: uuidv4(),
      roomId: client.currentRoomId,
      type: 'broadcast',
      action: 'task.changed',
      payload: { action: 'delete', task_id: taskId },
      timestamp: Date.now()
    })
  }

  private async broadcastTaskWithSubtasks(roomId: string, taskId: string) {
    const task = await taskService.getTask(taskId)
    this.broadcastToRoom(roomId, {
      msgId: uuidv4(),
      roomId,
      type: 'broadcast',
      action: 'task.changed',
      payload: { action: 'update', task },
      timestamp: Date.now()
    })
  }

  private async handleTaskSubtaskAdd(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return
    const taskId = payload.task_id || payload.taskId || payload.id
    if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'task_id is required' }
    await taskService.assertTaskInRoom(taskId, client.currentRoomId)
    await taskItemService.create(taskId, {
      title: payload.title,
      description: payload.description,
      status: payload.status,
      assigneeId: payload.assignee_id || payload.assigneeId,
      assigneeName: payload.assignee_name || payload.assigneeName,
      assigneeType: payload.assignee_type || payload.assigneeType,
      createdBy: client.userId,
    })
    await this.broadcastTaskWithSubtasks(client.currentRoomId, taskId)
  }

  private async handleTaskSubtaskUpdate(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return
    const itemId = payload.item_id || payload.itemId || payload.subtaskId || payload.id
    if (!itemId) throw { code: 'VALIDATION_ERROR', message: 'item_id is required' }
    const before = taskItemService.get(itemId)
    await taskService.assertTaskInRoom(before.taskId, client.currentRoomId)
    const item = await taskItemService.update(itemId, payload.updates || {
      ...(payload.title !== undefined ? { title: payload.title } : {}),
      ...(payload.description !== undefined ? { description: payload.description } : {}),
      ...(payload.status !== undefined ? { status: payload.status } : {}),
      ...(payload.assigneeId !== undefined ? { assigneeId: payload.assigneeId } : {}),
      ...(payload.assigneeName !== undefined ? { assigneeName: payload.assigneeName } : {}),
      ...(payload.assigneeType !== undefined ? { assigneeType: payload.assigneeType } : {}),
    })
    await this.broadcastTaskWithSubtasks(client.currentRoomId, item.taskId)
  }

  private async handleTaskSubtaskDelete(clientId: string, payload: any) {
    const client = this.clients.get(clientId)
    if (!client || !client.currentRoomId) return
    const itemId = payload.item_id || payload.itemId || payload.subtaskId || payload.id
    if (!itemId) throw { code: 'VALIDATION_ERROR', message: 'item_id is required' }
    const item = taskItemService.get(itemId)
    await taskService.assertTaskInRoom(item.taskId, client.currentRoomId)
    await taskItemService.delete(itemId)
    await this.broadcastTaskWithSubtasks(client.currentRoomId, item.taskId)
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
      void this.maybeAutoInvokeAssistant(roomId, user.nickname || user.username, payload.content)
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
