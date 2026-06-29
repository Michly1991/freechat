import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, relative } from 'path'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { agentPackageService } from './agent-package.service.js'
import { aiConfigService } from './ai-config.service.js'

const ROOM_MESSAGE_THRESHOLD = 40
const AGENT_MESSAGE_THRESHOLD = 20
const CHAR_THRESHOLD = 20_000
const DAILY_THRESHOLD_MS = 24 * 60 * 60 * 1000
const MAX_SOURCE_CHARS = 60_000
const MAX_MEMORY_CHARS = 18_000

export type MemoryScope = 'room' | 'agent'

type MemoryState = {
  scope_type: MemoryScope
  room_id: string
  agent_id?: string | null
  last_message_created_at?: number | null
  last_run_finished_at?: number | null
  last_compacted_at?: number | null
  message_count_since_compact?: number | null
  char_count_since_compact?: number | null
}

function safeAgentId(agentId?: string | null) { return agentId || '__room__' }

function clampText(value: string, max = MAX_SOURCE_CHARS) {
  const text = String(value || '')
  return text.length > max ? `${text.slice(0, max)}\n\n[内容过长，已截断]` : text
}

function stripCodeFence(text: string) {
  return String(text || '').replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trim()
}

function mergeFallback(existing: string, generated: string, scope: MemoryScope, title: string) {
  const now = new Date().toISOString()
  const body = stripCodeFence(generated)
  if (!body || /^无长期价值|NO_MEMORY/i.test(body)) {
    return existing || `# ${title}\n\n暂无可复用长期记忆。\n\n## Last Updated\n${now}\n`
  }
  const header = existing?.trim() || `# ${title}\n\n`
  return `${header}\n\n## Update ${now}\n\n${body}\n`.slice(-MAX_MEMORY_CHARS)
}

export class ConversationMemoryService {
  private running = new Set<string>()

  memoryDir(roomId: string) { return join(agentPackageService.roomDir(roomId), 'memory') }
  roomMemoryPath(roomId: string) { return join(this.memoryDir(roomId), 'ROOM_MEMORY.md') }
  agentMemoryPath(roomId: string, agentId: string) { return join(this.memoryDir(roomId), 'agents', `${agentId}.md`) }

  async readRoomMemory(roomId: string) { return this.readOptional(this.roomMemoryPath(roomId)) }
  async readAgentMemory(roomId: string, agentId: string) { return this.readOptional(this.agentMemoryPath(roomId, agentId)) }

  async onMessageCreated(input: { roomId: string; actorId: string; actorRole: 'human' | 'ai'; content: string; createdAt: number }) {
    const chars = String(input.content || '').length
    this.bumpState('room', input.roomId, null, input.createdAt, chars)
    if (input.actorRole === 'ai' && input.actorId) this.bumpState('agent', input.roomId, input.actorId, input.createdAt, chars)
    await this.maybeCompact('room', input.roomId).catch((err) => console.error('[conversation-memory] room compact failed', err))
    if (input.actorRole === 'ai' && input.actorId) await this.maybeCompact('agent', input.roomId, input.actorId).catch((err) => console.error('[conversation-memory] agent compact failed', err))
  }

  async onRunCompleted(input: { roomId: string; agentId: string; input?: string; output?: string; finishedAt: number }) {
    const chars = String(input.input || '').length + String(input.output || '').length
    this.bumpState('agent', input.roomId, input.agentId, input.finishedAt, chars)
    await this.maybeCompact('agent', input.roomId, input.agentId).catch((err) => console.error('[conversation-memory] agent compact failed', err))
  }

  private stateKey(scope: MemoryScope, roomId: string, agentId?: string | null) { return `${scope}:${roomId}:${safeAgentId(agentId)}` }

  private getState(scope: MemoryScope, roomId: string, agentId?: string | null): MemoryState {
    return db.prepare('SELECT * FROM conversation_memory_state WHERE scope_type = ? AND room_id = ? AND agent_id IS ?')
      .get(scope, roomId, agentId || null) as MemoryState || { scope_type: scope, room_id: roomId, agent_id: agentId || null }
  }

  private bumpState(scope: MemoryScope, roomId: string, agentId: string | null, eventAt: number, chars: number) {
    const now = Date.now()
    db.prepare(`
      INSERT INTO conversation_memory_state (scope_type, room_id, agent_id, last_message_created_at, message_count_since_compact, char_count_since_compact, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(scope_type, room_id, agent_id) DO UPDATE SET
        last_message_created_at = MAX(COALESCE(last_message_created_at, 0), excluded.last_message_created_at),
        message_count_since_compact = COALESCE(message_count_since_compact, 0) + 1,
        char_count_since_compact = COALESCE(char_count_since_compact, 0) + excluded.char_count_since_compact,
        updated_at = excluded.updated_at
    `).run(scope, roomId, agentId, eventAt, chars, now)
  }

  async maybeCompact(scope: MemoryScope, roomId: string, agentId?: string | null) {
    const key = this.stateKey(scope, roomId, agentId)
    if (this.running.has(key)) return { compacted: false, reason: 'already_running' }
    const state = this.getState(scope, roomId, agentId)
    const count = Number(state.message_count_since_compact || 0)
    const chars = Number(state.char_count_since_compact || 0)
    const age = Date.now() - Number(state.last_compacted_at || 0)
    const hasPreviousCompaction = Number(state.last_compacted_at || 0) > 0
    const countThreshold = scope === 'room' ? ROOM_MESSAGE_THRESHOLD : AGENT_MESSAGE_THRESHOLD
    if (count < countThreshold && chars < CHAR_THRESHOLD && !(hasPreviousCompaction && count > 0 && age > DAILY_THRESHOLD_MS)) return { compacted: false, reason: 'below_threshold' }
    this.running.add(key)
    try { return await this.compact(scope, roomId, agentId || null, state) }
    finally { this.running.delete(key) }
  }

  async compact(scope: MemoryScope, roomId: string, agentId: string | null, state?: MemoryState) {
    const currentState = state || this.getState(scope, roomId, agentId)
    const since = Number(currentState.last_compacted_at || 0)
    const rows = this.loadSourceRows(scope, roomId, agentId, since)
    if (!rows.length) {
      this.markCompacted(scope, roomId, agentId, Date.now(), Number(currentState.last_message_created_at || 0), Number(currentState.last_run_finished_at || 0))
      return { compacted: false, reason: 'no_source' }
    }
    const sourceFrom = Math.min(...rows.map((r) => Number(r.createdAt || 0)).filter(Boolean)) || since
    const sourceTo = Math.max(...rows.map((r) => Number(r.createdAt || 0)).filter(Boolean)) || Date.now()
    const source = clampText(rows.map((r) => `### ${new Date(Number(r.createdAt)).toISOString()} ${r.actorName || r.actorId || ''} (${r.actorRole || r.kind})\n${r.content || ''}`).join('\n\n'))
    const existing = scope === 'room' ? await this.readRoomMemory(roomId) : await this.readAgentMemory(roomId, agentId!)
    const title = scope === 'room' ? 'Room Memory' : `Agent Memory: ${this.agentName(agentId!)}`
    const generated = await this.generateMemory(scope, roomId, agentId, existing, source)
    const useful = !/^\s*(NO_MEMORY|无长期价值)/i.test(generated)
    const newMemory = useful ? mergeFallback(existing, generated, scope, title) : mergeFallback(existing, '', scope, title)
    const targetPath = scope === 'room' ? this.roomMemoryPath(roomId) : this.agentMemoryPath(roomId, agentId!)
    await mkdir(join(targetPath, '..'), { recursive: true })
    await writeFile(targetPath, newMemory, 'utf8')
    const chunkPath = await this.writeChunk(scope, roomId, agentId, sourceFrom, generated || 'NO_MEMORY')
    const chunkId = `mem_${uuidv4()}`
    db.prepare(`
      INSERT INTO conversation_memory_chunks (id, scope_type, room_id, agent_id, file_path, source_from, source_to, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(chunkId, scope, roomId, agentId, relative(agentPackageService.roomDir(roomId), chunkPath), sourceFrom, sourceTo, generated || 'NO_MEMORY', Date.now())
    this.markCompacted(scope, roomId, agentId, Date.now(), sourceTo, Number(currentState.last_run_finished_at || 0))
    return { compacted: true, useful, chunkId, filePath: targetPath }
  }

  private loadSourceRows(scope: MemoryScope, roomId: string, agentId: string | null, since: number) {
    if (scope === 'agent' && agentId) {
      const messages = db.prepare(`
        SELECT actor_id actorId, actor_name actorName, actor_role actorRole, kind, content, created_at createdAt
        FROM messages
        WHERE room_id = ? AND deleted = 0 AND created_at > ? AND (actor_id = ? OR mentions LIKE ?)
        ORDER BY created_at ASC LIMIT 160
      `).all(roomId, since, agentId, `%${agentId}%`) as any[]
      const runs = db.prepare(`
        SELECT agent_id actorId, 'Agent run' actorName, 'agent_run' actorRole, run_source kind,
          ('Input:\n' || input || COALESCE('\n\nOutput:\n' || output, '') || COALESCE('\n\nError:\n' || error, '')) content,
          COALESCE(finished_at, started_at) createdAt
        FROM agent_runs
        WHERE room_id = ? AND agent_id = ? AND COALESCE(finished_at, started_at) > ?
        ORDER BY COALESCE(finished_at, started_at) ASC LIMIT 80
      `).all(roomId, agentId, since) as any[]
      return [...messages, ...runs].sort((a, b) => Number(a.createdAt) - Number(b.createdAt))
    }
    return db.prepare(`
      SELECT actor_id actorId, actor_name actorName, actor_role actorRole, kind, content, created_at createdAt
      FROM messages
      WHERE room_id = ? AND deleted = 0 AND created_at > ?
      ORDER BY created_at ASC LIMIT 240
    `).all(roomId, since) as any[]
  }

  private async generateMemory(scope: MemoryScope, roomId: string, agentId: string | null, existing: string, source: string) {
    const room = db.prepare('SELECT name, description FROM rooms WHERE id = ?').get(roomId) as any
    const agent = agentId ? db.prepare('SELECT name, description FROM agents WHERE id = ?').get(agentId) as any : null
    const prompt = `你是 FreeChat 的长期记忆整理器。请从新增对话/Agent运行记录中提取“未来仍有用”的记忆，并和现有记忆合并成一份简洁 Markdown。\n\n硬性要求：\n- 只保留后续会复用的信息：用户确认的决策、目标、约束/偏好/禁忌、当前进展、未完成事项、长期引用的文件/接口/数据结构、Agent承诺。\n- 删除寒暄、流水账、一次性中间过程、无结论讨论、无复用价值的日志。\n- 如果新增内容没有长期价值，只输出：NO_MEMORY。\n- 不要编造。不要保留敏感原文，除非它是用户明确要求长期保存的业务资料。\n- 输出必须是 Markdown，控制在 2500 字以内。\n\n范围：${scope === 'room' ? '房间记忆' : `Agent 记忆：${agent?.name || agentId}`}\n房间：${room?.name || roomId}\n房间说明：${room?.description || ''}\n\n现有记忆：\n${existing || '（暂无）'}\n\n新增材料：\n${source}`
    try { return stripCodeFence(await aiConfigService.callAI(prompt, { maxTokens: 2500 })) }
    catch (err) {
      console.error('[conversation-memory] AI compact fallback', err)
      return this.extractFallback(source)
    }
  }

  private extractFallback(source: string) {
    const lines = source.split('\n').map((line) => line.trim()).filter(Boolean)
    const important = lines.filter((line) => /决定|确认|必须|不要|偏好|约束|待办|TODO|阻塞|下次|记住|目标|方案|接口|文件|路径|Agent|用户/.test(line)).slice(0, 40)
    return important.length ? `## 自动摘要（规则兜底）\n\n${important.map((line) => `- ${line.replace(/^[-*]\s*/, '')}`).join('\n')}` : 'NO_MEMORY'
  }

  private async writeChunk(scope: MemoryScope, roomId: string, agentId: string | null, sourceFrom: number, summary: string) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dir = scope === 'room'
      ? join(this.memoryDir(roomId), 'chunks', 'room')
      : join(this.memoryDir(roomId), 'chunks', 'agents', agentId!)
    await mkdir(dir, { recursive: true })
    const file = join(dir, `mem_${sourceFrom || Date.now()}_${stamp}.md`)
    await writeFile(file, `# Memory Chunk\n\n- Scope: ${scope}\n- Room: ${roomId}\n${agentId ? `- Agent: ${agentId}\n` : ''}- Created At: ${new Date().toISOString()}\n\n${summary}\n`, 'utf8')
    return file
  }

  private markCompacted(scope: MemoryScope, roomId: string, agentId: string | null, compactedAt: number, lastMessageAt: number, lastRunAt: number) {
    db.prepare(`
      INSERT INTO conversation_memory_state (scope_type, room_id, agent_id, last_message_created_at, last_run_finished_at, last_compacted_at, message_count_since_compact, char_count_since_compact, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
      ON CONFLICT(scope_type, room_id, agent_id) DO UPDATE SET
        last_message_created_at = MAX(COALESCE(last_message_created_at, 0), excluded.last_message_created_at),
        last_run_finished_at = MAX(COALESCE(last_run_finished_at, 0), excluded.last_run_finished_at),
        last_compacted_at = excluded.last_compacted_at,
        message_count_since_compact = 0,
        char_count_since_compact = 0,
        updated_at = excluded.updated_at
    `).run(scope, roomId, agentId, lastMessageAt || 0, lastRunAt || 0, compactedAt, Date.now())
  }

  private agentName(agentId: string) {
    const row = db.prepare('SELECT name FROM agents WHERE id = ?').get(agentId) as any
    return row?.name || agentId
  }

  private async readOptional(path: string) {
    if (!existsSync(path)) return ''
    return readFile(path, 'utf8').catch(() => '')
  }
}

export const conversationMemoryService = new ConversationMemoryService()
