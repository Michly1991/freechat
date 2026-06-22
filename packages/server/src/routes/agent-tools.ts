import { FastifyInstance } from 'fastify'
import { readdir, readFile } from 'fs/promises'
import { join, normalize } from 'path'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { config } from '../config.js'
import { verifyAgentToolToken } from '../agent-tool-token.js'
import { messageService } from '../services/message.service.js'
import { taskService } from '../services/task.service.js'
import { taskItemService } from '../services/task-item.service.js'
import { taskRetryService } from '../services/task-retry.service.js'
import { roomService } from '../services/room.service.js'
import { membersService } from '../services/members.service.js'
import { agentService } from '../services/agent.service.js'
import { agentRestartService } from '../services/agent-restart.service.js'
import { agentCapabilityService } from '../services/agent-capability.service.js'
import { sceneTemplateService } from '../services/scene-template.service.js'
import { tabConfigService } from '../services/tab-config.service.js'
import { interactionService } from '../services/interaction.service.js'
import { materializeAgentCreateRequest, materializeTaskPlan } from './interactions.js'
import { handleAppUiTool } from './agent-tools.app-ui.js'; import { handleFileTool } from './agent-tools-file.js'; import { handleTabTool } from './agent-tools-tab.js'; import { handleRoomHandoffTool } from './agent-tools-handoff.js'
import { getGateway } from '../ws/gateway.js'
import { getActiveAgentStream } from '../ws/agent-stream-events.js'
import { agentStreamService } from '../services/agent-stream.service.js'
import { roomAnalyticsService } from '../services/room-analytics.service.js'
import { tabFilesMapService } from '../services/tab-files-map.service.js'
import { notificationService } from '../services/notification.service.js'
import { remoteAgentConnectorService } from '../services/remote-agent-connector.service.js'
import { workgroupService } from '../services/workgroup.service.js'
import { assertNoFakeHandoffText, assertProjectFilePathAllowed, broadcast, buildSubtaskWakePrompt, invokeAssignedAgent, resolveAgentAssignee, safeRelativePath, throwTabNotFound, validateTabIds } from './agent-tools.helpers.js'
export async function registerAgentToolRoutes(app: FastifyInstance) {
  app.post('/api/agent-tools/:roomId', async (request, reply) => {
    const { roomId } = request.params as any
    const auth = request.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    let verified = verifyAgentToolToken(roomId, token)
    let remoteAuth: any = null
    if (!verified.ok || !verified.agentId) {
      remoteAuth = await remoteAgentConnectorService.authenticateBearer(request.headers.authorization)
      if (remoteAuth) verified = { ok: true, agentId: remoteAuth.agentId, actorUserId: remoteAuth.ownerId }
    }
    if (!verified.ok || !verified.agentId) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid agent tool token' } })
    }
    const roomAgent = db.prepare('SELECT 1 FROM room_agents WHERE room_id = ? AND agent_id = ?').get(roomId, verified.agentId)
    if (!roomAgent) return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Agent is not in this room' } })

    const agent = await agentService.getAgent(verified.agentId)
    const actorUserId = verified.actorUserId || (db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(roomId) as any)?.created_by || agent.ownerId || agent.id
    const assertActorCanEditRoom = () => {
      const member = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, actorUserId) as any
      if (!member || !['owner', 'editor'].includes(member.role)) throw { code: 'FORBIDDEN', message: 'Only project owner/editor can perform this operation' }
    }
    const body = request.body as any
    const action = body.action || body.tool
    const args = body.args || {}
    const filesDir = join(config.workspace.root, roomId, 'files')
    const activeRunId = roomAnalyticsService.findActiveRun(roomId, agent.id)
    const activeStreamId = getActiveAgentStream(roomId, agent.id)
    let toolCallId: string | null = null
    let toolError: any = null
    if (action) {
      toolCallId = roomAnalyticsService.createToolCall({
        roomId,
        agentId: agent.id,
        runId: activeRunId,
        streamId: activeStreamId,
        toolName: String(action),
        action: String(action),
        inputSummary: roomAnalyticsService.summarizeInput(args),
      })
      reply.raw.once('finish', () => {
        if (!toolCallId) return
        const failed = reply.statusCode >= 400
        roomAnalyticsService.finishToolCall(toolCallId, failed
          ? { status: 'failed', errorCode: roomAnalyticsService.errorCode(toolError, reply.statusCode), errorMessage: roomAnalyticsService.errorMessage(toolError || `HTTP ${reply.statusCode}`) }
          : { status: 'succeeded' })
      })
    }

    try {
      agentService.assertToolAllowed(agent, String(action || ''))
      if (activeStreamId && action && !String(action).startsWith('tool.')) {
        const activity = agentStreamService.addActivity(activeStreamId, { text: `正在执行 ${String(action)}`, tool: String(action) })
        broadcast(roomId, 'agent.stream.activity', { id: activeStreamId, agentId: agent.id, ...activity })
      }
      const appUiTool = await handleAppUiTool({ action: String(action || ''), args, roomId, actorUserId, agentId: agent.id, broadcast })
      if (appUiTool.handled) {
        return appUiTool.response
      }
      const fileTool = await handleFileTool({ action: String(action || ''), args, roomId, filesDir, actorUserId, broadcast })
      if (fileTool.handled) {
        return fileTool.response
      }
      const tabTool = await handleTabTool({ action: String(action || ''), args, roomId, actorUserId, broadcast })
      if (tabTool.handled) {
        return tabTool.response
      }
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
          return { success: true, data: { message: msg } }
        }
        case 'task.list': {
          const tasks = await taskService.getRoomTasks(roomId, args.status)
          return { success: true, data: { tasks } }
        }
        case 'task.create': {
          const existing = await taskService.findReusableTask(roomId, args.title)
          if (existing) {
            return { success: true, data: { task: existing, reused: true, hint: '已复用房间中同名未关闭任务；如需推进，请使用 task progress/update 或 subtask add。' } }
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
          return { success: true, data: { task } }
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
          return { success: true, data: { task } }
        }
        case 'task.progress': {
          const taskId = args.taskId || args.id || args.task_id
          const note = String(args.note || args.progressNote || '').trim()
          if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'taskId is required' }
          if (!note) throw { code: 'VALIDATION_ERROR', message: 'note is required' }
          await taskService.assertTaskInRoom(taskId, roomId)
          const task = await taskService.updateTask(taskId, { progressNote: note } as any)
          broadcast(roomId, 'task.changed', { action: 'update', task })
          return { success: true, data: { task } }
        }
        case 'task.retry': {
          const taskId = args.taskId || args.id || args.task_id
          if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'taskId is required' }
          await taskService.assertTaskInRoom(taskId, roomId)
          const { task, wakeItems } = await taskRetryService.retryTaskFailedItems(taskId, agent.id, args.reason)
          broadcast(roomId, 'task.changed', { action: 'update', task })
          for (const item of wakeItems) await invokeAssignedAgent(roomId, item.assigneeId!, agent.id, buildSubtaskWakePrompt(task, item, '任务被人工重试，请重新处理该子任务。'), actorUserId, { taskId: task.id, subtaskId: item.id })
          return { success: true, data: { task, wakeItems } }
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
          return { success: true, data: { subtask, task } }
        }
        case 'task.subtask_list':
        case 'task.subtask.list': {
          const taskId = args.taskId || args.task_id || args.id
          if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'taskId is required' }
          await taskService.assertTaskInRoom(taskId, roomId)
          const subtasks = taskItemService.list(taskId)
          return { success: true, data: { subtasks, summary: taskItemService.summary(subtasks) } }
        }
        case 'task.subtask_add':
        case 'task.subtask.add': {
          const taskId = args.taskId || args.task_id || args.id
          if (!taskId) throw { code: 'VALIDATION_ERROR', message: 'taskId is required' }
          await taskService.assertTaskInRoom(taskId, roomId)
          const existing = taskItemService.findReusableItem(taskId, args.title)
          if (existing) {
            const task = await taskService.getTask(taskId)
            return { success: true, data: { subtask: existing, task, reused: true, hint: '已复用父任务下同名未关闭子任务；如需推进，请更新子任务状态/进展。' } }
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
          return { success: true, data: { subtask, task } }
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
          return { success: true, data: { subtask, task, released } }
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
          return { success: true, data: result }
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
          return { success: true, data: { task } }
        }
        case 'interaction.create': {
          const result = await interactionService.create(roomId, { id: agent.id, name: agent.name, role: 'ai' }, {
            type: args.type || 'confirm',
            title: args.title,
            description: args.description,
            options: args.options,
            targetUserId: args.targetUserId,
            expiresAt: args.expiresAt,
          })
          broadcast(roomId, 'chat.message', result.message)
          broadcast(roomId, 'interaction.created', { interaction: result.interaction })
          return { success: true, data: result }
        }
        case 'interaction.list': {
          const interactions = interactionService.list(roomId, { status: args.status, targetUserId: args.targetUserId })
          return { success: true, data: { interactions } }
        }
        case 'interaction.get': {
          const interaction = interactionService.get(roomId, args.id || args.interactionId)
          return { success: true, data: { interaction } }
        }
        case 'interaction.respond': {
          const interactionId = args.id || args.interactionId
          if (!interactionId) throw { code: 'VALIDATION_ERROR', message: 'interactionId is required' }
          const value = args.value ?? args.values
          if (value === undefined) throw { code: 'VALIDATION_ERROR', message: 'value is required' }
          const interaction = interactionService.respond(roomId, interactionId, args.userId || agent.id, value, args.inputs || {})
          broadcast(roomId, 'interaction.updated', { interaction })
          await materializeAgentCreateRequest(roomId, interaction)
          await materializeTaskPlan(roomId, interaction)
          return { success: true, data: { interaction } }
        }
        case 'interaction.consume': {
          const interaction = interactionService.consume(roomId, args.id || args.interactionId, agent.id)
          broadcast(roomId, 'interaction.updated', { interaction })
          return { success: true, data: { interaction } }
        }
        case 'tab-config.list': {
          const tab = await tabConfigService.getTab(roomId, String(args.tabKey || 'files'))
          return { success: true, data: { tab } }
        }
        case 'tab-config.add-file': {
          const rel = safeRelativePath(args.path)
          assertProjectFilePathAllowed(rel)
          const tab = await tabConfigService.addFile(roomId, String(args.tabKey || 'files'), rel); await tabFilesMapService.writeRoomMap(roomId)
          broadcast(roomId, 'files.updated', { path: rel, tabKey: String(args.tabKey || 'files') })
          return { success: true, data: { tab } }
        }
        case 'tab.files': { const content = await tabFilesMapService.writeAgentMap(roomId, agent.id); await tabFilesMapService.writeRoomMap(roomId); return { success: true, data: { content } } }
        case 'tab-config.remove-file': {
          const rel = safeRelativePath(args.path)
          const tab = await tabConfigService.removeFile(roomId, String(args.tabKey || 'files'), rel); await tabFilesMapService.writeRoomMap(roomId)
          broadcast(roomId, 'files.updated', { path: rel, tabKey: String(args.tabKey || 'files') })
          return { success: true, data: { tab } }
        }
        case 'tab.list': {
          const tabs = db.prepare(`
            SELECT * FROM tabs WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC
          `).all(roomId)
          return { success: true, data: { tabs } }
        }
        case 'tab.create': {
          const title = String(args.title || '').trim()
          if (!title) throw { code: 'VALIDATION_ERROR', message: 'title is required' }
          const tabId = `tab_${uuidv4()}`
          const now = Date.now()
          const maxOrder: any = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM tabs WHERE room_id = ?').get(roomId)
          db.prepare(`
            INSERT INTO tabs (id, room_id, title, content, icon, sort_order, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(tabId, roomId, title, String(args.content || ''), args.icon || 'file', (maxOrder?.max_order ?? -1) + 1, actorUserId, now, now)
          if (args.makeDefault === true || args.default === true) {
            db.prepare(`INSERT INTO room_tab_preferences (room_id, default_tab_id, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET default_tab_id = excluded.default_tab_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(roomId, tabId, actorUserId, now)
          }
          const defaultTabId = (db.prepare('SELECT default_tab_id FROM room_tab_preferences WHERE room_id = ?').get(roomId) as any)?.default_tab_id || tabId
          await roomService.updateLastActive(roomId)
          const tab = db.prepare('SELECT * FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
          broadcast(roomId, 'tabs.updated', { action: 'add', tab, defaultTabId })
          return { success: true, data: { tab, defaultTabId } }
        }
        case 'tab.create-from-file': {
          const title = String(args.title || '').trim()
          if (!title) throw { code: 'VALIDATION_ERROR', message: 'title is required' }
          const rel = safeRelativePath(args.path)
          const content = await readFile(join(filesDir, rel), 'utf8')
          const tabId = `tab_${uuidv4()}`
          const now = Date.now()
          const maxOrder: any = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM tabs WHERE room_id = ?').get(roomId)
          db.prepare(`
            INSERT INTO tabs (id, room_id, title, content, icon, sort_order, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(tabId, roomId, title, content, args.icon || 'file', (maxOrder?.max_order ?? -1) + 1, actorUserId, now, now)
          if (args.makeDefault === true || args.default === true) {
            db.prepare(`INSERT INTO room_tab_preferences (room_id, default_tab_id, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET default_tab_id = excluded.default_tab_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(roomId, tabId, actorUserId, now)
          }
          const defaultTabId = (db.prepare('SELECT default_tab_id FROM room_tab_preferences WHERE room_id = ?').get(roomId) as any)?.default_tab_id || tabId
          await roomService.updateLastActive(roomId)
          const tab = db.prepare('SELECT * FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
          broadcast(roomId, 'tabs.updated', { action: 'add', tab, defaultTabId })
          return { success: true, data: { tab, defaultTabId } }
        }
        case 'tab.update': {
          const tabId = String(args.tabId || args.id || '').trim()
          if (!tabId) throw { code: 'VALIDATION_ERROR', message: 'tabId is required' }

          let content = args.content
          if (args.path) {
            const rel = safeRelativePath(args.path)
            content = await readFile(join(filesDir, rel), 'utf8')
          }

          const updates: string[] = []
          const values: any[] = []
          if (args.title !== undefined) { updates.push('title = ?'); values.push(String(args.title)) }
          if (content !== undefined) { updates.push('content = ?'); values.push(String(content)) }
          if (args.icon !== undefined) { updates.push('icon = ?'); values.push(String(args.icon)) }
          if (updates.length === 0) throw { code: 'VALIDATION_ERROR', message: 'no fields to update' }
          updates.push('updated_at = ?')
          values.push(Date.now(), tabId, roomId)
          const result = db.prepare(`UPDATE tabs SET ${updates.join(', ')} WHERE id = ? AND room_id = ?`).run(...values)
          if (result.changes === 0) throwTabNotFound(tabId)
          await roomService.updateLastActive(roomId)
          const tab = db.prepare('SELECT * FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
          if (!tab) throwTabNotFound(tabId)
          broadcast(roomId, 'tabs.updated', { action: 'update', tab })
          return { success: true, data: { tab } }
        }
        case 'tab.delete': {
          const tabId = String(args.tabId || args.id || '').trim()
          if (!tabId) throw { code: 'VALIDATION_ERROR', message: 'tabId is required' }
          const currentDefault = (db.prepare('SELECT default_tab_id FROM room_tab_preferences WHERE room_id = ?').get(roomId) as any)?.default_tab_id
          const result = db.prepare('DELETE FROM tabs WHERE id = ? AND room_id = ?').run(tabId, roomId)
          if (result.changes === 0) throwTabNotFound(tabId)
          if (currentDefault === tabId) {
            const next = db.prepare('SELECT id FROM tabs WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1').get(roomId) as any
            db.prepare(`INSERT INTO room_tab_preferences (room_id, default_tab_id, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET default_tab_id = excluded.default_tab_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(roomId, next?.id || null, actorUserId, Date.now())
          }
          await roomService.updateLastActive(roomId)
          const defaultTabId = (db.prepare('SELECT default_tab_id FROM room_tab_preferences WHERE room_id = ?').get(roomId) as any)?.default_tab_id || null
          broadcast(roomId, 'tabs.updated', { action: 'delete', tabId, defaultTabId })
          return { success: true }
        }
        case 'tab.set-default': {
          const target = String(args.tabId || args.id || args.title || '').trim()
          if (!target) throw { code: 'VALIDATION_ERROR', message: 'tabId or title is required' }
          const tab = db.prepare('SELECT * FROM tabs WHERE room_id = ? AND (id = ? OR title = ?) LIMIT 1').get(roomId, target, target) as any
          if (!tab) throwTabNotFound(target)
          db.prepare(`INSERT INTO room_tab_preferences (room_id, default_tab_id, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET default_tab_id = excluded.default_tab_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(roomId, tab.id, actorUserId, Date.now())
          await roomService.updateLastActive(roomId)
          broadcast(roomId, 'tabs.updated', { action: 'set-default', tabId: tab.id, defaultTabId: tab.id })
          return { success: true, data: { defaultTabId: tab.id, tab } }
        }
        case 'tab.reorder': {
          if (!Array.isArray(args.tabIds)) throw { code: 'VALIDATION_ERROR', message: 'tabIds must be an array' }
          validateTabIds(roomId, args.tabIds)
          const updateStmt = db.prepare('UPDATE tabs SET sort_order = ?, updated_at = ? WHERE id = ? AND room_id = ?')
          const now = Date.now()
          const transaction = db.transaction((ids: string[]) => {
            ids.forEach((id, index) => updateStmt.run(index, now, id, roomId))
          })
          transaction(args.tabIds)
          await roomService.updateLastActive(roomId)
          broadcast(roomId, 'tabs.updated', { action: 'reorder', tabIds: args.tabIds })
          return { success: true }
        }
        case 'agent.list_available':
        case 'agent.list-available': {
          await agentService.assertRoomAssistant(roomId, agent.id)
          const agents = await agentService.getAvailableAgentsForRoom(roomId, agent.id)
          return { success: true, data: { agents } }
        }
        case 'agent.create_request':
        case 'agent.create-request':
        case 'agent.create': {
          await agentService.assertRoomAssistant(roomId, agent.id)
          const name = String(args.name || '').trim()
          if (!name) throw { code: 'VALIDATION_ERROR', message: 'agent name is required' }
          const roleType = args.roleType === 'assistant' ? 'assistant' : 'specialist'
          const specialties = Array.isArray(args.specialties) ? args.specialties.map((s: any) => String(s).trim()).filter(Boolean) : []
          const result = await interactionService.create(roomId, { id: agent.id, name: agent.name, role: 'ai' }, {
            type: 'confirm',
            title: `确认创建 Agent：${name}`,
            description: [
              args.description ? `职责：${args.description}` : '',
              specialties.length ? `专长：${specialties.join('、')}` : '',
              '确认后会创建该 Agent 并加入当前项目。',
            ].filter(Boolean).join('\n'),
            priority: 'important',
            payload: {
              agentCreate: {
                name,
                roleType,
                deployment: 'client',
                description: args.description,
                specialties,
                config: args.config || undefined,
                roomRole: args.roomRole === 'assistant' ? 'assistant' : 'specialist',
                autoEnabled: args.autoEnabled === true,
                priority: Number(args.priority || 0),
              }
            },
            options: [
              { value: 'confirm', label: '确认创建', style: 'primary' },
              { value: 'cancel', label: '取消', style: 'secondary' },
            ],
            responsePolicy: { allowChange: false, allowCancel: true },
          } as any)
          broadcast(roomId, 'interaction.created', { interaction: result.interaction })
          broadcast(roomId, 'chat.message', result.message)
          return { success: true, data: result }
        }
        case 'agent.restart': {
          await agentService.assertRoomAssistant(roomId, agent.id)
          const target = args.agent || args.agentId || args.id || args.name
          if (!target) throw { code: 'VALIDATION_ERROR', message: 'agent is required' }
          const result = await agentRestartService.restart(roomId, target, agent.id, { mode: args.force === true || args.mode === 'force' ? 'force' : 'soft', clearSession: args.clearSession !== false })
          broadcast(roomId, 'agent.status_update', { agentId: result.agent.id, status: 'active', onlineStatus: 'online', lastActiveAt: Date.now(), lastError: null })
          if (result.pendingSubtasks.length > 0) {
            const lines = result.pendingSubtasks.map((item: any, i: number) => `${i + 1}. 父任务 ${item.task_id}「${item.task_title}」 / 子任务 ${item.id}「${item.title}」`).join('\n')
            await invokeAssignedAgent(roomId, result.agent.id, agent.id, `你刚刚被人工${result.mode === 'force' ? '强制重启' : '软恢复'}，请继续处理已分派但未完成的子任务：\n${lines}\n\n请先用 ./freechat task subtask update 标记状态/进展。项目交付文件必须通过 ./freechat file write-local <项目文件路径> <本地文件路径> --show 或 ./freechat file write <项目文件路径> <内容> --show 写入；直接写 res/ 只是私有工作区，用户文件目录不可见。完成后在聊天中简短汇报。`, actorUserId)
          }
          return { success: true, data: result }
        }
        case 'room.handoff': return handleRoomHandoffTool(roomId, agent, actorUserId, args)
        case 'agent.add': {
          await agentService.assertRoomAssistant(roomId, agent.id)
          const target = await agentService.resolveAvailableAgentForRoom(roomId, agent.id, args.agent || args.agentId || args.name)
          const roomRole = args.roomRole === 'assistant' ? 'assistant' : (target.roleType === 'assistant' ? 'assistant' : 'specialist')
          await agentService.addAgentToRoom(roomId, target.id, actorUserId, {
            roomRole,
            autoEnabled: args.autoEnabled === true,
            priority: Number(args.priority || 0),
          })
          await agentService.refreshRoomAgentContext(roomId)
          const members = await roomService.getRoomMembers(roomId)
          const agents = await agentService.getRoomAgents(roomId)
          broadcast(roomId, 'room.members_update', { members, agents })
          return { success: true, data: { agent: target, agents } }
        }
        case 'agent.remove': {
          await agentService.assertRoomAssistant(roomId, agent.id)
          assertActorCanEditRoom()
          const target = args.agent || args.agentId || args.id || args.name
          if (!target) throw { code: 'VALIDATION_ERROR', message: 'agent is required' }
          const roomAgents = await agentService.getRoomAgents(roomId)
          const targetAgent = roomAgents.find((item: any) => item.id === target || item.name === target)
          if (!targetAgent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found in room' }
          await agentService.removeAgentFromRoom(roomId, targetAgent.id)
          await agentService.refreshRoomAgentContext(roomId)
          const nextAgents = await agentService.getRoomAgents(roomId)
          broadcast(roomId, 'room.members_update', { members: await roomService.getRoomMembers(roomId), agents: nextAgents })
          return { success: true, data: { agents: nextAgents } }
        }
        case 'agent.detail': {
          const target = args.agent || args.agentId || args.id || agent.id
          const targetAgent = await agentService.getAgent(target)
          const skills = agentCapabilityService.listSkills(targetAgent.id)
          const scripts = agentCapabilityService.listScripts(targetAgent.id)
          return { success: true, data: { agent: targetAgent, skills, scripts } }
        }
        case 'agent.update': {
          const target = args.agent || args.agentId || args.id
          if (!target) throw { code: 'VALIDATION_ERROR', message: 'agent is required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          const updated = await agentService.updateAgent(target, args.updates || args)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { success: true, data: { agent: updated } }
        }
        case 'agent.skill.list': {
          const target = args.agent || args.agentId || args.id || agent.id
          return { success: true, data: { skills: agentCapabilityService.listSkills(target) } }
        }
        case 'agent.skill.create': {
          const target = args.agent || args.agentId || args.id
          if (!target) throw { code: 'VALIDATION_ERROR', message: 'agent is required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          const skill = agentCapabilityService.createSkill(target, args)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { success: true, data: { skill } }
        }
        case 'agent.skill.update': {
          const target = args.agent || args.agentId || args.id
          const skillId = args.skillId || args.skill_id
          if (!target || !skillId) throw { code: 'VALIDATION_ERROR', message: 'agent and skillId are required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          const skill = agentCapabilityService.updateSkill(target, skillId, args.updates || args)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { success: true, data: { skill } }
        }
        case 'agent.skill.delete': {
          const target = args.agent || args.agentId || args.id
          const skillId = args.skillId || args.skill_id
          if (!target || !skillId) throw { code: 'VALIDATION_ERROR', message: 'agent and skillId are required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          agentCapabilityService.deleteSkill(target, skillId)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { success: true }
        }
        case 'agent.script.list': {
          const target = args.agent || args.agentId || args.id || agent.id
          return { success: true, data: { scripts: agentCapabilityService.listScripts(target) } }
        }
        case 'agent.script.create': {
          const target = args.agent || args.agentId || args.id
          if (!target) throw { code: 'VALIDATION_ERROR', message: 'agent is required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          const script = agentCapabilityService.createScript(target, args)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { success: true, data: { script } }
        }
        case 'agent.script.update': {
          const target = args.agent || args.agentId || args.id
          const scriptId = args.scriptId || args.script_id
          if (!target || !scriptId) throw { code: 'VALIDATION_ERROR', message: 'agent and scriptId are required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          const script = agentCapabilityService.updateScript(target, scriptId, args.updates || args)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { success: true, data: { script } }
        }
        case 'agent.script.delete': {
          const target = args.agent || args.agentId || args.id
          const scriptId = args.scriptId || args.script_id
          if (!target || !scriptId) throw { code: 'VALIDATION_ERROR', message: 'agent and scriptId are required' }
          await agentService.assertAgentOwner(target, actorUserId, undefined)
          agentCapabilityService.deleteScript(target, scriptId)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { success: true }
        }
        case 'scene.list': {
          return { success: true, data: { scenes: sceneTemplateService.listScenes({ id: actorUserId, role: undefined }) } }
        }
        case 'scene.create': {
          const scene = sceneTemplateService.createScene(actorUserId, args)
          return { success: true, data: { scene } }
        }
        case 'scene.update': {
          const sceneId = args.sceneId || args.id
          if (!sceneId) throw { code: 'VALIDATION_ERROR', message: 'sceneId is required' }
          const scene = sceneTemplateService.updateScene({ id: actorUserId, role: undefined }, sceneId, args.updates || args)
          return { success: true, data: { scene } }
        }
        case 'members.list': {
          const members = await roomService.getRoomMembers(roomId)
          const agents = await agentService.getRoomAgents(roomId)
          return { success: true, data: { members, agents } }
        }
        case 'workgroup.info': {
          const workgroup = workgroupService.getRoomWorkgroup(roomId)
          return { success: true, data: { workgroup } }
        }
        case 'workgroup.members': {
          const workgroup = workgroupService.getRoomWorkgroup(roomId)
          return { success: true, data: { workgroup, members: workgroupService.listMembers(workgroup.id) } }
        }
        case 'workgroup.agents': {
          const workgroup = workgroupService.getRoomWorkgroup(roomId)
          return { success: true, data: { workgroup, agents: workgroupService.listAgents(workgroup.id) } }
        }
        case 'workgroup.rooms': {
          const workgroup = workgroupService.getRoomWorkgroup(roomId)
          return { success: true, data: { workgroup, rooms: workgroupService.listRooms(workgroup.id, actorUserId) } }
        }
        case 'room.create': {
          await agentService.assertRoomAssistant(roomId, agent.id)
          const result = await workgroupService.createRoomFromWorkgroup(roomId, actorUserId, agent.id, args)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          broadcast(result.room.id, 'room.members_update', { members: result.members, agents: result.agents })
          const msg = await messageService.createMessage(roomId, agent.id, '新建协作会话', 'ai', `已创建协作会话「${result.room.name}」，并加入指定成员和 Agent。`)
          broadcast(roomId, 'chat.message', msg)
          return { success: true, data: result }
        }
        case 'members.add': {
          assertActorCanEditRoom()
          const userId = args.userId || args.id
          if (!userId) throw { code: 'VALIDATION_ERROR', message: 'userId is required' }
          const role = ['owner', 'editor', 'viewer'].includes(args.role) ? args.role : 'editor'
          await roomService.addMember(roomId, userId, role)
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          const members = await roomService.getRoomMembers(roomId)
          broadcast(roomId, 'room.members_update', { members, agents: await agentService.getRoomAgents(roomId) })
          return { success: true, data: { members } }
        }
        case 'profiles.update': {
          assertActorCanEditRoom()
          const memberId = args.memberId || args.userId || args.id
          if (!memberId) throw { code: 'VALIDATION_ERROR', message: 'memberId is required' }
          const profile = await membersService.setProfile(roomId, memberId, {
            displayName: args.displayName || args.roleTitle || args.role_title,
            roleDescription: args.roleDescription || args.persona,
            avatar: args.avatar,
            customData: args.customData || {
              specialties: args.specialties,
              roleTitle: args.roleTitle || args.role_title,
              persona: args.persona,
            },
          })
          await agentService.refreshRoomAgentContext(roomId).catch(() => {})
          return { success: true, data: { profile } }
        }
        case 'room.info': {
          const room = await roomService.getRoom(roomId)
          return { success: true, data: { room } }
        }
        case 'room.update': {
          assertActorCanEditRoom()
          const room = await roomService.updateRoom(roomId, args.name, args.description)
          broadcast(roomId, 'room.updated', { room })
          return { success: true, data: { room } }
        }
        case 'room.create-invite': {
          assertActorCanEditRoom()
          const code = uuidv4().replace(/-/g, '').substring(0, 12)
          const now = Date.now()
          const expiresAt = args.expiresInDays ? now + Number(args.expiresInDays) * 24 * 60 * 60 * 1000 : null
          db.prepare(`
            INSERT INTO room_invites (code, room_id, created_by, max_uses, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(code, roomId, actorUserId, args.maxUses || null, expiresAt, now)
          return { success: true, data: { code, url: `/invite?code=${code}`, expiresAt } }
        }
        default:
          toolError = { code: 'UNKNOWN_ACTION', message: `Unknown action: ${action}` }
          return reply.code(400).send({ success: false, error: toolError })
      }
    } catch (err: any) {
      const status = ['TAB_NOT_FOUND', 'USER_NOT_FOUND', 'DM_NOT_FOUND', 'REQUEST_NOT_FOUND', 'ROOM_NOT_FOUND', 'AGENT_NOT_FOUND'].includes(err.code) ? 404
        : ['INVALID_PATH', 'VALIDATION_ERROR', 'CANNOT_ADD_SELF'].includes(err.code) ? 400
          : ['AGENT_TOOL_FORBIDDEN', 'FORBIDDEN'].includes(err.code) ? 403
            : ['ALREADY_FRIENDS', 'REQUEST_PENDING'].includes(err.code) ? 409
              : 500
      toolError = err
      return reply.code(status).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })
}
