import { WebSocket } from 'ws'
import { v4 as uuidv4 } from 'uuid'
import { agentService } from '../services/agent.service.js'
import { taskService } from '../services/task.service.js'
import { taskItemService } from '../services/task-item.service.js'
import { taskRetryService } from '../services/task-retry.service.js'
import type { BroadcastToRoom, ClientConnection, InvokeReason } from './gateway-types.js'

export class TaskHandler {
  constructor(
    private getClient: (clientId: string) => ClientConnection | undefined,
    private broadcastToRoom: BroadcastToRoom,
    private invokeMentionedAgents: (roomId: string, content: string, mentions: any[], reason?: InvokeReason, actorUserId?: string) => Promise<void>
  ) {}

  async handleTaskList(clientId: string, payload: any) {
    const client = this.getClient(clientId)
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

  async handleTaskAdd(clientId: string, payload: any) {
    const client = this.getClient(clientId)
    if (!client || !client.currentRoomId) return

    const title = String(payload.title || '').trim()
    if (!title) throw { code: 'VALIDATION_ERROR', message: '任务标题不能为空' }

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
      void this.invokeMentionedAgents(client.currentRoomId, prompt, [{ id: assigneeId, name: assigneeName || '助理', role: 'ai' }], 'task', client.userId)
    }
  }

  async handleTaskUpdate(clientId: string, payload: any) {
    const client = this.getClient(clientId)
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
    if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'task_id is required' }

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

  async handleTaskProgress(clientId: string, payload: any) {
    const client = this.getClient(clientId)
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

  async handleTaskDelete(clientId: string, payload: any) {
    const client = this.getClient(clientId)
    if (!client || !client.currentRoomId) return

    const taskId = payload.task_id || payload.taskId || payload.id
    if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'task_id is required' }
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

  async handleTaskSubtaskAdd(clientId: string, payload: any) {
    const client = this.getClient(clientId)
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

  async handleTaskSubtaskUpdate(clientId: string, payload: any) {
    const client = this.getClient(clientId)
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
      ...(payload.blockedReason !== undefined ? { blockedReason: payload.blockedReason } : {}),
    })
    const released = []
    if (item.status === 'done') {
      for (const dep of taskItemService.readyDependents(item.id)) released.push(await taskItemService.releaseDependent(dep.id))
    }
    await this.broadcastTaskWithSubtasks(client.currentRoomId, item.taskId)
    if (released.length > 0) {
      const task = await taskService.getTask(item.taskId)
      for (const dep of released) {
        if (dep.assigneeType === 'agent' && dep.assigneeId) {
          void this.invokeMentionedAgents(client.currentRoomId, this.buildSubtaskWakePrompt(task, dep, '前置子任务已完成，你负责的子任务已解除阻塞，请立即处理。'), [{ id: dep.assigneeId, name: dep.assigneeName || 'Agent', role: 'ai' }], 'task', client.userId)
        }
      }
    }
  }

  async handleTaskRetry(clientId: string, payload: any) {
    const client = this.getClient(clientId)
    if (!client || !client.currentRoomId) return
    const taskId = payload.task_id || payload.taskId || payload.id
    if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'task_id is required' }
    await taskService.assertTaskInRoom(taskId, client.currentRoomId)
    const { task, wakeItems } = await taskRetryService.retryTaskFailedItems(taskId, client.userId, payload.reason)
    this.broadcastToRoom(client.currentRoomId, { msgId: uuidv4(), roomId: client.currentRoomId, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task }, timestamp: Date.now() })
    for (const item of wakeItems) void this.invokeMentionedAgents(client.currentRoomId, this.buildSubtaskWakePrompt(task, item, '用户已人工重试该子任务，请重新处理。'), [{ id: item.assigneeId, name: item.assigneeName || 'Agent', role: 'ai' }], 'task', client.userId)
  }

  async handleTaskSubtaskRetry(clientId: string, payload: any) {
    const client = this.getClient(clientId)
    if (!client || !client.currentRoomId) return
    const itemId = payload.item_id || payload.itemId || payload.subtaskId || payload.id
    if (!itemId) throw { code: 'VALIDATION_ERROR', message: 'item_id is required' }
    const before = taskItemService.get(itemId)
    await taskService.assertTaskInRoom(before.taskId, client.currentRoomId)
    const { subtask, task, shouldWake } = await taskRetryService.retrySubtask(itemId, client.userId, payload.reason)
    this.broadcastToRoom(client.currentRoomId, { msgId: uuidv4(), roomId: client.currentRoomId, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task }, timestamp: Date.now() })
    if (shouldWake) void this.invokeMentionedAgents(client.currentRoomId, this.buildSubtaskWakePrompt(task, subtask, '用户已人工重试该子任务，请重新处理。'), [{ id: subtask.assigneeId, name: subtask.assigneeName || 'Agent', role: 'ai' }], 'task', client.userId)
  }

  async handleTaskSubtaskDelete(clientId: string, payload: any) {
    const client = this.getClient(clientId)
    if (!client || !client.currentRoomId) return
    const itemId = payload.item_id || payload.itemId || payload.subtaskId || payload.id
    if (!itemId) throw { code: 'VALIDATION_ERROR', message: 'item_id is required' }
    const item = taskItemService.get(itemId)
    await taskService.assertTaskInRoom(item.taskId, client.currentRoomId)
    await taskItemService.delete(itemId)
    await this.broadcastTaskWithSubtasks(client.currentRoomId, item.taskId)
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

  private buildSubtaskWakePrompt(task: any, subtask: any, reason: string) {
    return [
      reason,
      `父任务ID: ${task.id}`,
      `父任务标题: ${task.title}`,
      `子任务ID: ${subtask.id}`,
      `子任务标题: ${subtask.title}`,
      subtask.description ? `子任务说明: ${subtask.description}` : '',
      '',
      '请先用 ./freechat task subtask update 标记状态/进展，完成后在聊天中简短汇报。',
    ].filter(Boolean).join('\n')
  }

  private sendToClient(clientId: string, message: any) {
    const client = this.getClient(clientId)
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message))
    }
  }
}
