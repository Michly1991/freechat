import { readdir, stat } from 'fs/promises'
import { join, normalize, relative } from 'path'
import db from '../storage/db.js'
import { config } from '../config.js'
import { getWebSocketGateway } from '../ws/gateway.js'
import { agentService } from '../services/agent.service.js'
import { messageService } from '../services/message.service.js'
import { agentTaskCompletionService } from '../services/agent-task-completion.service.js'
import { agentArtifactService } from '../services/agent-artifact.service.js'

export function safeRelativePath(input = ''): string {
  const cleaned = normalize(input).replace(/^([/\\])+/, '')
  if (cleaned.startsWith('..') || cleaned.includes(`..\\`) || cleaned.includes('../')) {
    throw { code: 'INVALID_PATH', message: 'Path escapes room workspace' }
  }
  return cleaned || '.'
}

export async function buildFileTree(dir: string, prefix = ''): Promise<any[]> {
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

export function broadcast(roomId: string, action: string, payload: any) {
  getWebSocketGateway()?.broadcast(roomId, {
    msgId: payload?.id || `${action}_${Date.now()}`,
    roomId,
    type: 'broadcast',
    action,
    payload,
    timestamp: Date.now()
  })
}

export function throwTabNotFound(tabId?: string) {
  throw { code: 'TAB_NOT_FOUND', message: tabId ? `Tab not found: ${tabId}` : 'Tab not found' }
}

export function validateTabIds(roomId: string, tabIds: string[]) {
  if (tabIds.length === 0) return
  const rows = db.prepare(`SELECT id FROM tabs WHERE room_id = ? AND id IN (${tabIds.map(() => '?').join(',')})`).all(roomId, ...tabIds) as any[]
  const existing = new Set(rows.map((r) => r.id))
  const missing = tabIds.filter((id) => !existing.has(id))
  if (missing.length > 0) throwTabNotFound(missing.join(', '))
}

export async function resolveAgentAssignee(roomId: string, args: any): Promise<{ assigneeId?: string; assigneeName?: string; assigneeType?: 'human' | 'agent' }> {
  const raw = args.assigneeId || args.assignee_id || args.assignee || args.assigneeName || args.assignee_name
  if (!raw && !args.assigneeType && !args.assignee_type) return {}
  const text = String(raw || '').trim().replace(/^@/, '')
  if (!text) return {}
  const roomAgents = await agentService.getRoomAgents(roomId)
  const agent = roomAgents.find((a) => a.id === text || a.name === text || a.name.includes(text) || text.includes(a.name))
  if (!agent) throw { code: 'AGENT_ASSIGNEE_NOT_FOUND', message: `Agent assignee not found in room: ${text}` }
  return { assigneeId: agent.id, assigneeName: agent.name, assigneeType: 'agent' }
}

export function buildSubtaskWakePrompt(task: any, subtask: any, reason: string) {
  return [
    reason,
    `父任务ID: ${task.id}`,
    `父任务标题: ${task.title}`,
    `子任务ID: ${subtask.id}`,
    `子任务标题: ${subtask.title}`,
    subtask.description ? `子任务说明: ${subtask.description}` : '',
    '',
    '请先用 ./freechat task subtask update 标记状态/进展。项目交付文件必须通过 ./freechat file write-local <项目文件路径> <本地文件路径> --show 或 ./freechat file write <项目文件路径> <内容> --show 写入；直接写 res/ 只是私有工作区，用户文件目录不可见。完成后在聊天中简短汇报。',
  ].filter(Boolean).join('\n')
}

export async function invokeAssignedAgent(roomId: string, assigneeId: string | undefined, assigningAgentId: string, prompt: string, actorUserId?: string) {
  if (!assigneeId) return
  const roomAgents = await agentService.getRoomAgents(roomId)
  const assigned = roomAgents.find((a) => a.id === assigneeId)
  if (!assigned) return

  void (async () => {
    try {
      await agentService.updateAgent(assigned.id, { status: 'working' } as any)
      broadcast(roomId, 'agent.status_update', { agentId: assigned.id, status: 'working', onlineStatus: 'working', lastActiveAt: Date.now() })
      const result = await agentService.spawnClaudeCode(roomId, assigned.id, prompt, { timeoutMs: config.agent.taskTimeoutMs, actorUserId })
      await agentArtifactService.publishDeclaredArtifacts(roomId, assigned.id, prompt)
      const completed = await agentTaskCompletionService.autoCompleteFromRun(prompt, result.response || '')
      if (completed) broadcast(roomId, 'task.changed', { action: 'update', task: completed.task })
      await agentService.updateAgent(assigned.id, { status: 'active' } as any)
      broadcast(roomId, 'agent.status_update', { agentId: assigned.id, status: 'active', onlineStatus: 'online', lastActiveAt: Date.now() })
      if (completed?.released?.length) {
        for (const item of completed.released) {
          if (item.assigneeType === 'agent' && item.assigneeId) {
            void invokeAssignedAgent(roomId, item.assigneeId, assigned.id, buildSubtaskWakePrompt(completed.task, item, '前置子任务已完成，你负责的子任务已解除阻塞，请立即处理。'), actorUserId)
          }
        }
      }
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



export function assertProjectFilePathAllowed(rel: string): void {
  const forbidden = /^(res|scripts|skills|agents|\.freechat|meta|workspace-data|data)(\/|$)/i
  if (forbidden.test(rel)) {
    throw {
      code: 'PROJECT_PATH_FORBIDDEN',
      message: `项目正式交付文件不能写到 ${rel}。这些是 Agent 私有/系统目录名。请先执行 ./freechat tab files 查看目录地图，再改写到 docs/、ui/、正文/、剧情/、角色/、设定/、素材/、reports/ 等项目路径。`
    }
  }
}
