import { messageService } from '../services/message.service.js'
import { taskService } from '../services/task.service.js'
import { taskItemService } from '../services/task-item.service.js'
import { taskRetryService } from '../services/task-retry.service.js'
import { agentService } from '../services/agent.service.js'
import { interactionService } from '../services/interaction.service.js'
import { notificationService } from '../services/notification.service.js'
import { materializeTaskPlan } from './interactions.js'
import { assertNoFakeHandoffText, buildSubtaskWakePrompt, invokeAssignedAgent, resolveAgentAssignee } from './agent-tools.helpers.js'

interface AgentTaskToolContext {
  action: string
  args: any
  roomId: string
  actorUserId: string
  agent: any
  broadcast: (roomId: string, action: string, payload: any) => void
}

export async function handleAgentTaskTool(ctx: AgentTaskToolContext): Promise<{ handled: boolean; response?: any }> {
  const { action, args, roomId, actorUserId, agent, broadcast } = ctx
  switch (action) {
        case 'chat.send': {
          const content = String(args.content || '').trim()
          if (!content) throw { code: 'VALIDATION_ERROR', message: 'content is required' }
          await assertNoFakeHandoffText(roomId, agent, content)
          const escapedAgentName = agent.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const selfMention = new RegExp(`@\\s*${escapedAgentName}`)
          if (selfMention.test(content) && /(?:通知|转发|提醒|交给|让|叫|已通知|已转发|已提醒)/.test(content)) throw { code: 'AGENT_SELF_MENTION_FORBIDDEN', message: `你就是 ${agent.name}，不要通知/转发/提醒 @自己；请直接处理并用第一人称汇报。` }
          const fakeMention = (await agentService.getRoomAgents(roomId)).find((item) => item.id !== agent.id && new RegExp(`@\\s*${item.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`).test(content))
          if (fakeMention && /(?:请|通知|转发|提醒|交给|让|叫|协助|处理|提供|帮忙|麻烦)/.test(content)) throw { code: 'AGENT_FAKE_MENTION_FORBIDDEN', message: `普通聊天里 @${fakeMention.name} 不会触发该 Agent；接待转交用 ./freechat room handoff --agent ${fakeMention.name} --reason <原因>；任务协作用 task/subtask --assignee ${fakeMention.name}。` }
          const msg = await messageService.createMessage(roomId, agent.id, agent.name, 'ai', content)
          broadcast(roomId, 'chat.message', msg)
          return { handled: true, response: { success: true, data: { message: msg } } }
        }
        case 'task.list': {
          const tasks = await taskService.getRoomTasks(roomId, args.status)
          return { handled: true, response: { success: true, data: { tasks } } }
        }
        case 'task.create': {
          const existing = await taskService.findReusableTask(roomId, args.title)
          if (existing) {
            return { handled: true, response: { success: true, data: { task: existing, reused: true, hint: '已复用房间中同名未关闭任务；如需推进，请使用 task progress/update 或 subtask add。' } } }
          }
          const hasExplicitAssignee = !!(args.assignee || args.assigneeId || args.assigneeName)
          const resolved = hasExplicitAssignee ? await resolveAgentAssignee(roomId, args) : {}
          const assigneeId = resolved.assigneeId || args.assigneeId || (agent.roleType === 'assistant' ? undefined : agent.id)
          const assigneeName = resolved.assigneeName || args.assigneeName || (agent.roleType === 'assistant' ? undefined : agent.name)
          const assigneeType = resolved.assigneeType || args.assigneeType || (assigneeId ? 'agent' : undefined)
          const task = await taskService.createTask(
            roomId,
            args.title,
            args.description,
            args.priority || 'medium',
            assigneeId,
            assigneeName,
            assigneeType,
            agent.id
          )
          broadcast(roomId, 'task.changed', { action: 'add', task })
          if (assigneeType === 'agent') {
            await invokeAssignedAgent(roomId, assigneeId, agent.id, ['你被分派了一个 FreeChat 任务，请立即处理。', `任务ID: ${task.id}`, `任务标题: ${task.title}`, task.description ? `任务说明: ${task.description}` : '', `分派来源 Agent: ${agent.name}`, '', '请先用 ./freechat task update 标记状态/进展，完成后在聊天中简短汇报。'].filter(Boolean).join('\n'), actorUserId, { taskId: task.id })
          }
          return { handled: true, response: { success: true, data: { task } } }
        }
        case 'task.update': {
          const taskId = args.taskId || args.id || args.task_id
          await taskService.assertTaskInRoom(taskId, roomId)
          const updates = { ...(args.updates || {}) }
          if (updates.status === 'done') {
            updates.status = 'review'
            updates.reviewNote = updates.reviewNote || updates.progressNote || 'Agent 已提交完成，等待人工确认。'
          }
          const beforeTask = await taskService.getTask(taskId), task = await taskService.updateTask(taskId, updates)
          if (task.status !== beforeTask.status) notificationService.notifyTaskDone({ roomId, taskId: task.id, title: task.title, createdBy: task.createdBy, actorId: agent.id, actorName: agent.name, status: task.status })
          broadcast(roomId, 'task.changed', { action: 'update', task })
          return { handled: true, response: { success: true, data: { task } } }
        }
        case 'task.progress': {
          const taskId = args.taskId || args.id || args.task_id
          const note = String(args.note || args.progressNote || '').trim()
          if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'taskId is required' }
          if (!note) throw { code: 'VALIDATION_ERROR', message: 'note is required' }
          await taskService.assertTaskInRoom(taskId, roomId)
          const task = await taskService.updateTask(taskId, { progressNote: note } as any)
          broadcast(roomId, 'task.changed', { action: 'update', task })
          return { handled: true, response: { success: true, data: { task } } }
        }
        case 'task.retry': {
          const taskId = args.taskId || args.id || args.task_id
          if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'taskId is required' }
          await taskService.assertTaskInRoom(taskId, roomId)
          const { task, wakeItems } = await taskRetryService.retryTaskFailedItems(taskId, agent.id, args.reason)
          broadcast(roomId, 'task.changed', { action: 'update', task })
          for (const item of wakeItems) await invokeAssignedAgent(roomId, item.assigneeId!, agent.id, buildSubtaskWakePrompt(task, item, '任务被人工重试，请重新处理该子任务。'), actorUserId, { taskId: task.id, subtaskId: item.id })
          return { handled: true, response: { success: true, data: { task, wakeItems } } }
        }
        case 'task.subtask_retry':
        case 'task.subtask.retry': {
          const itemId = args.itemId || args.subtaskId || args.id || args.item_id
          if (!itemId) throw { code: 'VALIDATION_ERROR', message: 'itemId is required' }
          const before = taskItemService.get(itemId)
          await taskService.assertTaskInRoom(before.taskId, roomId)
          const { subtask, task, shouldWake } = await taskRetryService.retrySubtask(itemId, agent.id, args.reason)
          broadcast(roomId, 'task.changed', { action: 'update', task })
          if (shouldWake) await invokeAssignedAgent(roomId, subtask.assigneeId!, agent.id, buildSubtaskWakePrompt(task, subtask, '任务被人工重试，请重新处理该子任务。'), actorUserId, { taskId: task.id, subtaskId: subtask.id })
          return { handled: true, response: { success: true, data: { subtask, task } } }
        }
        case 'task.subtask_list':
        case 'task.subtask.list': {
          const taskId = args.taskId || args.task_id || args.id
          if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'taskId is required' }
          await taskService.assertTaskInRoom(taskId, roomId)
          const subtasks = taskItemService.list(taskId)
          return { handled: true, response: { success: true, data: { subtasks, summary: taskItemService.summary(subtasks) } } }
        }
        case 'task.subtask_add':
        case 'task.subtask.add': {
          const taskId = args.taskId || args.task_id || args.id
          if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'taskId is required' }
          await taskService.assertTaskInRoom(taskId, roomId)
          const existing = taskItemService.findReusableItem(taskId, args.title)
          if (existing) {
            const task = await taskService.getTask(taskId)
            return { handled: true, response: { success: true, data: { subtask: existing, task, reused: true, hint: '已复用父任务下同名未关闭子任务；如需推进，请更新子任务状态/进展。' } } }
          }
          const resolved = await resolveAgentAssignee(roomId, args)
          const assigneeId = resolved.assigneeId || args.assigneeId || agent.id
          const assigneeName = resolved.assigneeName || args.assigneeName || agent.name
          const assigneeType = resolved.assigneeType || args.assigneeType || 'agent'
          const subtask = await taskItemService.create(taskId, {
            title: args.title,
            description: args.description,
            status: args.status,
            assigneeId,
            assigneeName,
            assigneeType,
            createdBy: agent.id,
          })
          const task = await taskService.getTask(taskId)
          broadcast(roomId, 'task.changed', { action: 'update', task })
          if (assigneeType === 'agent') {
            await invokeAssignedAgent(roomId, assigneeId, agent.id, ['你被分派了一个 FreeChat 子任务，请立即处理。', `父任务ID: ${task.id}`, `父任务标题: ${task.title}`, `子任务ID: ${subtask.id}`, `子任务标题: ${subtask.title}`, subtask.description ? `子任务说明: ${subtask.description}` : '', `分派来源 Agent: ${agent.name}`, '', '请先用 ./freechat task subtask update 标记状态/进展，完成后在聊天中简短汇报。'].filter(Boolean).join('\n'), actorUserId, { taskId: task.id, subtaskId: subtask.id })
          }
          return { handled: true, response: { success: true, data: { subtask, task } } }
        }
        case 'task.subtask_update':
        case 'task.subtask.update': {
          const itemId = args.itemId || args.subtaskId || args.id || args.item_id
          if (!itemId) throw { code: 'VALIDATION_ERROR', message: 'itemId is required' }
          const before = taskItemService.get(itemId)
          await taskService.assertTaskInRoom(before.taskId, roomId)
          const subtask = await taskItemService.update(itemId, args.updates || {})
          const released = []
          if (subtask.status === 'done') {
            for (const item of taskItemService.readyDependents(subtask.id)) released.push(await taskItemService.releaseDependent(item.id))
          }
          const task = await taskService.getTask(subtask.taskId)
          if (subtask.status !== before.status) notificationService.notifyTaskDone({ roomId, taskId: task.id, title: subtask.title, createdBy: task.createdBy, actorId: agent.id, actorName: agent.name, status: subtask.status })
          broadcast(roomId, 'task.changed', { action: 'update', task })
          for (const item of released) {
            if (item.assigneeType === 'agent' && item.assigneeId) {
              await invokeAssignedAgent(roomId, item.assigneeId, agent.id, buildSubtaskWakePrompt(task, item, '前置子任务已完成，你负责的子任务已解除阻塞，请立即处理。'), actorUserId, { taskId: task.id, subtaskId: item.id })
            }
          }
          return { handled: true, response: { success: true, data: { subtask, task, released } } }
        }
        case 'task.plan.create':
        case 'task.plan_create': {
          const title = String(args.title || '').trim()
          if (!title) throw { code: 'VALIDATION_ERROR', message: 'title is required' }
          const items = Array.isArray(args.items) ? args.items : []
          if (items.length === 0) throw { code: 'VALIDATION_ERROR', message: 'items are required' }
          for (const [index, item] of items.entries()) {
            if (!String(item?.title || '').trim()) throw { code: 'VALIDATION_ERROR', message: `item[${index}].title is required` }
          }
          const existing = await taskService.findReusableTask(roomId, title)
          const result = await interactionService.create(roomId, { id: agent.id, name: agent.name, role: 'ai' }, {
            type: 'task_plan',
            title: existing ? `任务计划预览：复用「${title}」` : `任务计划预览：${title}`,
            description: [existing ? `检测到房间中已有同名未关闭任务，将复用任务 ${existing.id} 并只补充缺失子任务。` : '', args.description].filter(Boolean).join('\n'),
            priority: args.priority === 'danger' ? 'danger' : 'important',
            payload: {
              taskPlan: {
                title,
                description: args.description,
                priority: args.priority || 'medium',
                reuseTaskId: existing?.id,
                items: items.map((item: any) => ({
                  title: String(item.title || '').trim(),
                  description: item.description,
                  assignee: item.assignee || item.assigneeName || item.assigneeId,
                  dependsOn: item.dependsOn,
                  expectedOutput: item.expectedOutput,
                  acceptanceCriteria: item.acceptanceCriteria,
                })),
              }
            }
          })
          broadcast(roomId, 'chat.message', result.message)
          broadcast(roomId, 'interaction.created', { interaction: result.interaction })
          return { handled: true, response: { success: true, data: result } }
        }
        case 'task.subtask_delete':
        case 'task.subtask.delete': {
          const itemId = args.itemId || args.subtaskId || args.id || args.item_id
          if (!itemId) throw { code: 'VALIDATION_ERROR', message: 'itemId is required' }
          const subtask = taskItemService.get(itemId)
          await taskService.assertTaskInRoom(subtask.taskId, roomId)
          await taskItemService.delete(itemId)
          const task = await taskService.getTask(subtask.taskId)
          broadcast(roomId, 'task.changed', { action: 'update', task })
          return { handled: true, response: { success: true, data: { task } } }
        }
    default:
      return { handled: false }
  }
}
