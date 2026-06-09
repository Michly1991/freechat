import { FastifyInstance } from 'fastify'
import { mkdir, readdir, readFile, writeFile, stat } from 'fs/promises'
import { join, dirname, normalize } from 'path'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { config } from '../config.js'
import { verifyAgentToolToken } from '../agent-tool-token.js'
import { messageService } from '../services/message.service.js'
import { taskService } from '../services/task.service.js'
import { taskItemService } from '../services/task-item.service.js'
import { roomService } from '../services/room.service.js'
import { agentService } from '../services/agent.service.js'
import { tabConfigService } from '../services/tab-config.service.js'
import { interactionService } from '../services/interaction.service.js'
import { getGateway } from '../ws/gateway.js'

function safeRelativePath(input = ''): string {
  const cleaned = normalize(input).replace(/^([/\\])+/, '')
  if (cleaned.startsWith('..') || cleaned.includes(`..\\`) || cleaned.includes('../')) {
    throw { code: 'INVALID_PATH', message: 'Path escapes room workspace' }
  }
  return cleaned || '.'
}

async function buildFileTree(dir: string, prefix = ''): Promise<any[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const items = []
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      items.push({ name: entry.name, path: relativePath, type: 'directory', children: await buildFileTree(fullPath, relativePath) })
    } else {
      const stats = await stat(fullPath)
      items.push({ name: entry.name, path: relativePath, type: 'file', size: stats.size, modifiedAt: stats.mtime.getTime() })
    }
  }
  return items.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  })
}

function broadcast(roomId: string, action: string, payload: any) {
  getGateway()?.broadcast(roomId, {
    msgId: payload?.id || `${action}_${Date.now()}`,
    roomId,
    type: 'broadcast',
    action,
    payload,
    timestamp: Date.now()
  })
}

function throwTabNotFound(tabId?: string) {
  throw { code: 'TAB_NOT_FOUND', message: tabId ? `Tab not found: ${tabId}` : 'Tab not found' }
}

function validateTabIds(roomId: string, tabIds: string[]) {
  if (tabIds.length === 0) return
  const rows = db.prepare(`SELECT id FROM tabs WHERE room_id = ? AND id IN (${tabIds.map(() => '?').join(',')})`).all(roomId, ...tabIds) as any[]
  const existing = new Set(rows.map((r) => r.id))
  const missing = tabIds.filter((id) => !existing.has(id))
  if (missing.length > 0) throwTabNotFound(missing.join(', '))
}

async function resolveAgentAssignee(roomId: string, args: any): Promise<{ assigneeId?: string; assigneeName?: string; assigneeType?: 'human' | 'agent' }> {
  const raw = args.assigneeId || args.assignee_id || args.assignee || args.assigneeName || args.assignee_name
  if (!raw && !args.assigneeType && !args.assignee_type) return {}
  const text = String(raw || '').trim().replace(/^@/, '')
  if (!text) return {}
  const roomAgents = await agentService.getRoomAgents(roomId)
  const agent = roomAgents.find((a) => a.id === text || a.name === text || a.name.includes(text) || text.includes(a.name))
  if (!agent) throw { code: 'AGENT_ASSIGNEE_NOT_FOUND', message: `Agent assignee not found in room: ${text}` }
  return { assigneeId: agent.id, assigneeName: agent.name, assigneeType: 'agent' }
}

async function invokeAssignedAgent(roomId: string, assigneeId: string | undefined, assigningAgentId: string, prompt: string) {
  if (!assigneeId || assigneeId === assigningAgentId) return
  const roomAgents = await agentService.getRoomAgents(roomId)
  const assigned = roomAgents.find((a) => a.id === assigneeId)
  if (!assigned) return

  void (async () => {
    try {
      await agentService.updateAgent(assigned.id, { status: 'working' } as any)
      broadcast(roomId, 'agent.status_update', { agentId: assigned.id, status: 'working', onlineStatus: 'working', lastActiveAt: Date.now() })
      const result = await agentService.spawnClaudeCode(roomId, assigned.id, prompt)
      await agentService.updateAgent(assigned.id, { status: 'active' } as any)
      broadcast(roomId, 'agent.status_update', { agentId: assigned.id, status: 'active', onlineStatus: 'online', lastActiveAt: Date.now() })
      if (result.silent || !result.response) return
      const msg = await messageService.createMessage(roomId, assigned.id, assigned.name, 'ai', result.response)
      broadcast(roomId, 'chat.message', msg)
    } catch (err: any) {
      await agentService.updateAgent(assigneeId, { status: 'error' } as any).catch(() => {})
      broadcast(roomId, 'agent.status_update', { agentId: assigneeId, status: 'error', onlineStatus: 'error', lastActiveAt: Date.now(), lastError: err?.message || String(err) })
      console.error(`Assigned agent ${assigneeId} invocation failed:`, err)
    }
  })()
}

export async function registerAgentToolRoutes(app: FastifyInstance) {
  app.post('/api/agent-tools/:roomId', async (request, reply) => {
    const { roomId } = request.params as any
    const auth = request.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const verified = verifyAgentToolToken(roomId, token)
    if (!verified.ok || !verified.agentId) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid agent tool token' } })
    }

    const agent = await agentService.getAgent(verified.agentId)
    const { action, args = {} } = request.body as any
    const filesDir = join(config.workspace.root, roomId, 'files')

    try {
      agentService.assertToolAllowed(agent, String(action || ''))
      switch (action) {
        case 'chat.send': {
          const content = String(args.content || '').trim()
          if (!content) throw { code: 'VALIDATION_ERROR', message: 'content is required' }
          const msg = await messageService.createMessage(roomId, agent.id, agent.name, 'ai', content)
          broadcast(roomId, 'chat.message', msg)
          return { success: true, data: { message: msg } }
        }
        case 'task.list': {
          const tasks = await taskService.getRoomTasks(roomId, args.status)
          return { success: true, data: { tasks } }
        }
        case 'task.create': {
          const resolved = await resolveAgentAssignee(roomId, args)
          const assigneeId = resolved.assigneeId || args.assigneeId || agent.id
          const assigneeName = resolved.assigneeName || args.assigneeName || agent.name
          const assigneeType = resolved.assigneeType || args.assigneeType || 'agent'
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
            await invokeAssignedAgent(roomId, assigneeId, agent.id, [
              '你被分派了一个 FreeChat 任务，请立即处理。',
              `任务ID: ${task.id}`,
              `任务标题: ${task.title}`,
              task.description ? `任务说明: ${task.description}` : '',
              `分派来源 Agent: ${agent.name}`,
              '',
              '请先用 ./freechat task update 标记状态/进展，完成后在聊天中简短汇报。',
            ].filter(Boolean).join('\n'))
          }
          return { success: true, data: { task } }
        }
        case 'task.update': {
          const taskId = args.taskId || args.id || args.task_id
          await taskService.assertTaskInRoom(taskId, roomId)
          const task = await taskService.updateTask(taskId, args.updates || {})
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
            await invokeAssignedAgent(roomId, assigneeId, agent.id, [
              '你被分派了一个 FreeChat 子任务，请立即处理。',
              `父任务ID: ${task.id}`,
              `父任务标题: ${task.title}`,
              `子任务ID: ${subtask.id}`,
              `子任务标题: ${subtask.title}`,
              subtask.description ? `子任务说明: ${subtask.description}` : '',
              `分派来源 Agent: ${agent.name}`,
              '',
              '请先用 ./freechat task subtask update 标记状态/进展，完成后在聊天中简短汇报。',
            ].filter(Boolean).join('\n'))
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
          const task = await taskService.getTask(subtask.taskId)
          broadcast(roomId, 'task.changed', { action: 'update', task })
          return { success: true, data: { subtask, task } }
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
          const result = await interactionService.create(roomId, { id: agent.id, name: agent.name, role: 'ai' }, {
            type: 'task_plan',
            title: `任务计划预览：${title}`,
            description: args.description,
            priority: args.priority === 'danger' ? 'danger' : 'important',
            payload: {
              taskPlan: {
                title,
                description: args.description,
                priority: args.priority || 'medium',
                items: items.map((item: any) => ({
                  title: String(item.title || '').trim(),
                  description: item.description,
                  assignee: item.assignee || item.assigneeName || item.assigneeId,
                  dependsOn: item.dependsOn,
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
        case 'interaction.consume': {
          const interaction = interactionService.consume(roomId, args.id || args.interactionId, agent.id)
          broadcast(roomId, 'interaction.updated', { interaction })
          return { success: true, data: { interaction } }
        }
        case 'file.list': {
          await mkdir(filesDir, { recursive: true })
          const files = await buildFileTree(filesDir)
          const tab = await tabConfigService.getTab(roomId, 'files')
          return { success: true, data: { files: tabConfigService.filterFileTree(files, tab), tabConfig: tab } }
        }
        case 'file.read': {
          const rel = safeRelativePath(args.path)
          const content = await readFile(join(filesDir, rel), 'utf8')
          return { success: true, data: { path: rel, content } }
        }
        case 'file.write': {
          const rel = safeRelativePath(args.path)
          const fullPath = join(filesDir, rel)
          await mkdir(dirname(fullPath), { recursive: true })
          await writeFile(fullPath, String(args.content || ''), 'utf8')
          if (args.showInTab === true || args.addToTab === true) {
            await tabConfigService.addFile(roomId, String(args.tabKey || 'files'), rel)
          }
          broadcast(roomId, 'files.updated', { path: rel })
          return { success: true, data: { path: rel } }
        }
        case 'tab-config.list': {
          const tab = await tabConfigService.getTab(roomId, String(args.tabKey || 'files'))
          return { success: true, data: { tab } }
        }
        case 'tab-config.add-file': {
          const rel = safeRelativePath(args.path)
          const tab = await tabConfigService.addFile(roomId, String(args.tabKey || 'files'), rel)
          broadcast(roomId, 'files.updated', { path: rel, tabKey: String(args.tabKey || 'files') })
          return { success: true, data: { tab } }
        }
        case 'tab-config.remove-file': {
          const rel = safeRelativePath(args.path)
          const tab = await tabConfigService.removeFile(roomId, String(args.tabKey || 'files'), rel)
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
          `).run(tabId, roomId, title, String(args.content || ''), args.icon || '📄', (maxOrder?.max_order ?? -1) + 1, agent.id, now, now)
          await roomService.updateLastActive(roomId)
          const tab = db.prepare('SELECT * FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
          broadcast(roomId, 'tabs.updated', { action: 'add', tab })
          return { success: true, data: { tab } }
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
          `).run(tabId, roomId, title, content, args.icon || '📄', (maxOrder?.max_order ?? -1) + 1, agent.id, now, now)
          await roomService.updateLastActive(roomId)
          const tab = db.prepare('SELECT * FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
          broadcast(roomId, 'tabs.updated', { action: 'add', tab })
          return { success: true, data: { tab } }
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
          const result = db.prepare('DELETE FROM tabs WHERE id = ? AND room_id = ?').run(tabId, roomId)
          if (result.changes === 0) throwTabNotFound(tabId)
          await roomService.updateLastActive(roomId)
          broadcast(roomId, 'tabs.updated', { action: 'delete', tabId })
          return { success: true }
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
        case 'members.list': {
          const members = await roomService.getRoomMembers(roomId)
          const agents = await agentService.getRoomAgents(roomId)
          return { success: true, data: { members, agents } }
        }
        case 'room.info': {
          const room = await roomService.getRoom(roomId)
          return { success: true, data: { room } }
        }
        default:
          return reply.code(400).send({ success: false, error: { code: 'UNKNOWN_ACTION', message: `Unknown action: ${action}` } })
      }
    } catch (err: any) {
      return reply.code(err.code === 'TAB_NOT_FOUND' ? 404 : (err.code === 'INVALID_PATH' || err.code === 'VALIDATION_ERROR' ? 400 : (err.code === 'AGENT_TOOL_FORBIDDEN' ? 403 : 500))).send({
        success: false,
        error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) }
      })
    }
  })
}
