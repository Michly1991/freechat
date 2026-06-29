import db from '../storage/db.js'
import { agentKnowledgeService } from './agent-knowledge.service.js'

export type RuntimeKnowledgeSource = 'room' | 'agent' | 'agent-entry' | 'public'

export type RuntimeKnowledgeResult = {
  source: RuntimeKnowledgeSource
  ref: string
  title: string
  excerpt: string
  score: number
  updatedAt: number
  tags?: string[]
  path?: string
  size?: number
}

function parseJsonArray(value: any): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.map(String).filter(Boolean)
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return String(value).split(',').map((x) => x.trim()).filter(Boolean)
  }
}

function tokenizeQuery(query: string) {
  return Array.from(new Set(String(query || '').toLowerCase().split(/[\s,，。；;：:、/\\]+/).map((x) => x.trim()).filter((x) => x.length >= 1))).slice(0, 12)
}

function scoreKnowledge(title: string, meta: string, content: string, terms: string[]) {
  if (terms.length === 0) return 1
  const t = String(title || '').toLowerCase()
  const m = String(meta || '').toLowerCase()
  const c = String(content || '').toLowerCase()
  let score = 0
  for (const term of terms) {
    if (t.includes(term)) score += 8
    if (m.includes(term)) score += 4
    const first = c.indexOf(term)
    if (first >= 0) score += 2 + Math.max(0, 2 - Math.floor(first / 1000))
  }
  return score
}

function excerptFor(content: string, terms: string[], max = 600) {
  const text = String(content || '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const lower = text.toLowerCase()
  const hit = terms.map((term) => lower.indexOf(term)).filter((idx) => idx >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, hit - Math.floor(max / 3))
  const end = Math.min(text.length, start + max)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

function assertAgentInRoom(roomId: string, agentId: string) {
  const row = db.prepare('SELECT 1 FROM room_agents WHERE room_id = ? AND agent_id = ?').get(roomId, agentId) as any
  if (!row) throw { code: 'FORBIDDEN', message: 'Agent is not in this room' }
}

function publicEntry(row: any, source: RuntimeKnowledgeSource, terms: string[]): RuntimeKnowledgeResult {
  const tags = parseJsonArray(row.tags)
  const score = scoreKnowledge(row.title, tags.join(' '), row.content, terms)
  return {
    source,
    ref: `${source === 'agent-entry' ? 'agent-entry' : source}:${row.id}`,
    title: row.title,
    tags,
    excerpt: excerptFor(row.content, terms),
    score,
    updatedAt: Number(row.updated_at || 0),
  }
}

export class KnowledgeRuntimeService {
  assertRuntimeAccess(roomId: string, agentId: string) { assertAgentInRoom(roomId, agentId) }

  summary(roomId: string, agentId: string) {
    this.assertRuntimeAccess(roomId, agentId)
    const rootAgentId = agentKnowledgeService.rootAgentId(agentId)
    const roomCount = (db.prepare("SELECT COUNT(*) count FROM knowledge_entries WHERE scope = 'room' AND room_id = ? AND status = 'active'").get(roomId) as any)?.count || 0
    const publicCount = (db.prepare("SELECT COUNT(*) count FROM knowledge_entries WHERE scope = 'public' AND status = 'active'").get() as any)?.count || 0
    const agentFileCount = (db.prepare('SELECT COUNT(*) count FROM agent_knowledge_files WHERE agent_id = ? AND deleted_at IS NULL').get(rootAgentId) as any)?.count || 0
    const legacyAgentCount = (db.prepare("SELECT COUNT(*) count FROM knowledge_entries WHERE scope = 'agent' AND agent_id = ? AND status = 'active'").get(agentId) as any)?.count || 0
    return { roomId, agentId, rootAgentId, sources: { room: roomCount, agent: agentFileCount + legacyAgentCount, public: publicCount } }
  }

  searchForAgent(input: { roomId: string; agentId: string; query: string; limit?: number; includeRoom?: boolean; includeAgent?: boolean; includePublic?: boolean }) {
    this.assertRuntimeAccess(input.roomId, input.agentId)
    const terms = tokenizeQuery(input.query)
    if (terms.length === 0) throw { code: 'VALIDATION_ERROR', message: 'knowledge query is required' }
    const limit = Math.min(Math.max(Number(input.limit || 8), 1), 20)
    const includeRoom = input.includeRoom !== false
    const includeAgent = input.includeAgent !== false
    const includePublic = input.includePublic !== false
    const rootAgentId = agentKnowledgeService.rootAgentId(input.agentId)
    const results: RuntimeKnowledgeResult[] = []

    if (includeRoom) {
      const rows = db.prepare("SELECT * FROM knowledge_entries WHERE scope = 'room' AND room_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 200").all(input.roomId) as any[]
      for (const row of rows) {
        const item = publicEntry(row, 'room', terms)
        if (item.score > 0) results.push(item)
      }
    }

    if (includeAgent) {
      const files = db.prepare('SELECT * FROM agent_knowledge_files WHERE agent_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 300').all(rootAgentId) as any[]
      for (const file of files) {
        const score = scoreKnowledge(file.path, file.name, file.content, terms)
        if (score > 0) results.push({ source: 'agent', ref: `agent:${file.id}`, title: file.name || file.path, path: file.path, size: file.size || 0, excerpt: excerptFor(file.content, terms), score, updatedAt: Number(file.updated_at || 0) })
      }
      const legacyRows = db.prepare("SELECT * FROM knowledge_entries WHERE scope = 'agent' AND agent_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 200").all(input.agentId) as any[]
      for (const row of legacyRows) {
        const item = publicEntry(row, 'agent-entry', terms)
        if (item.score > 0) results.push(item)
      }
    }

    if (includePublic) {
      const rows = db.prepare("SELECT * FROM knowledge_entries WHERE scope = 'public' AND status = 'active' ORDER BY updated_at DESC LIMIT 200").all() as any[]
      for (const row of rows) {
        const item = publicEntry(row, 'public', terms)
        if (item.score > 0) results.push(item)
      }
    }

    const order: Record<RuntimeKnowledgeSource, number> = { room: 0, agent: 1, 'agent-entry': 1, public: 2 }
    return { roomId: input.roomId, agentId: input.agentId, rootAgentId, query: input.query, results: results.sort((a, b) => (b.score || 0) - (a.score || 0) || order[a.source] - order[b.source] || Number(b.updatedAt || 0) - Number(a.updatedAt || 0)).slice(0, limit) }
  }

  readForAgent(input: { roomId: string; agentId: string; ref: string }) {
    this.assertRuntimeAccess(input.roomId, input.agentId)
    const ref = String(input.ref || '').trim()
    if (!ref) throw { code: 'VALIDATION_ERROR', message: 'knowledge ref is required' }
    if (ref.startsWith('room:')) {
      const id = ref.slice('room:'.length)
      const row = db.prepare("SELECT * FROM knowledge_entries WHERE id = ? AND scope = 'room' AND room_id = ? AND status = 'active'").get(id, input.roomId) as any
      if (!row) throw { code: 'KNOWLEDGE_FILE_NOT_FOUND', message: 'Room knowledge entry not found' }
      return { source: 'room', ref, entryId: row.id, title: row.title, tags: parseJsonArray(row.tags), content: row.content, updatedAt: row.updated_at }
    }
    if (ref.startsWith('public:')) {
      const id = ref.slice('public:'.length)
      const row = db.prepare("SELECT * FROM knowledge_entries WHERE id = ? AND scope = 'public' AND status = 'active'").get(id) as any
      if (!row) throw { code: 'KNOWLEDGE_FILE_NOT_FOUND', message: 'Public knowledge entry not found' }
      return { source: 'public', ref, entryId: row.id, title: row.title, tags: parseJsonArray(row.tags), content: row.content, updatedAt: row.updated_at }
    }
    if (ref.startsWith('agent-entry:')) {
      const id = ref.slice('agent-entry:'.length)
      const row = db.prepare("SELECT * FROM knowledge_entries WHERE id = ? AND scope = 'agent' AND agent_id = ? AND status = 'active'").get(id, input.agentId) as any
      if (!row) throw { code: 'KNOWLEDGE_FILE_NOT_FOUND', message: 'Agent knowledge entry not found' }
      return { source: 'agent-entry', ref, entryId: row.id, title: row.title, tags: parseJsonArray(row.tags), content: row.content, updatedAt: row.updated_at }
    }
    const raw = ref.startsWith('agent:') ? ref.slice('agent:'.length) : ref
    const file = agentKnowledgeService.read(input.agentId, raw) as any
    return { ...file, source: 'agent', ref: `agent:${file?.file?.id || raw}` }
  }

  getRuntimeContext(roomId: string, agentId: string, query: string, limit = 8) {
    const found = this.searchForAgent({ roomId, agentId, query, limit })
    if (!found.results.length) return ''
    return ['【可参考知识库】', ...found.results.map((item, index) => `#${index + 1} [${item.source}] ${item.title} (${item.ref})\n${item.excerpt.slice(0, 1200)}`)].join('\n\n')
  }
}

export const knowledgeRuntimeService = new KnowledgeRuntimeService()
