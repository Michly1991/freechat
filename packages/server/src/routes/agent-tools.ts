import { FastifyInstance } from 'fastify'
import { mkdir, readdir, readFile, writeFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname, normalize } from 'path'
import { config } from '../config.js'
import { verifyAgentToolToken } from '../agent-tool-token.js'
import { messageService } from '../services/message.service.js'
import { taskService } from '../services/task.service.js'
import { roomService } from '../services/room.service.js'
import { agentService } from '../services/agent.service.js'
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
          const task = await taskService.createTask(
            roomId,
            args.title,
            args.description,
            args.priority || 'medium',
            args.assigneeId || agent.id,
            args.assigneeName || agent.name,
            args.assigneeType || 'agent',
            agent.id
          )
          broadcast(roomId, 'task.changed', { action: 'add', task })
          return { success: true, data: { task } }
        }
        case 'task.update': {
          const task = await taskService.updateTask(args.taskId, args.updates || {})
          broadcast(roomId, 'task.changed', { action: 'update', task })
          return { success: true, data: { task } }
        }
        case 'file.list': {
          await mkdir(filesDir, { recursive: true })
          const files = await buildFileTree(filesDir)
          return { success: true, data: { files } }
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
          broadcast(roomId, 'files.updated', { path: rel })
          return { success: true, data: { path: rel } }
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
      return reply.code(err.code === 'INVALID_PATH' || err.code === 'VALIDATION_ERROR' ? 400 : 500).send({
        success: false,
        error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) }
      })
    }
  })
}
