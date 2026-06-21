import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { roomService } from './room.service.js'


type KnowledgeScope = 'public' | 'agent' | 'room'

type KnowledgeInput = {
  scope: KnowledgeScope
  title: string
  content: string
  tags?: string[]
  agentId?: string
  roomId?: string
  visibility?: string
  sourceType?: string
  sourceFileId?: string
}

function parseTags(raw: any): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean)
  try { return JSON.parse(raw) || [] } catch { return String(raw).split(',').map((x) => x.trim()).filter(Boolean) }
}

function rowToEntry(row: any) {
  return row ? {
    id: row.id,
    scope: row.scope,
    ownerUserId: row.owner_user_id || undefined,
    agentId: row.agent_id || undefined,
    roomId: row.room_id || undefined,
    title: row.title,
    content: row.content,
    tags: parseTags(row.tags),
    sourceType: row.source_type || 'manual',
    sourceFileId: row.source_file_id || undefined,
    status: row.status,
    visibility: row.visibility,
    createdBy: row.created_by,
    updatedBy: row.updated_by || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null
}

function normalizeInput(input: KnowledgeInput) {
  const scope = input.scope
  if (!['public', 'agent', 'room'].includes(scope)) throw { code: 'VALIDATION_ERROR', message: 'invalid knowledge scope' }
  const title = String(input.title || '').trim()
  const content = String(input.content || '').trim()
  if (!title || !content) throw { code: 'VALIDATION_ERROR', message: 'title and content are required' }
  if (scope === 'agent' && !input.agentId) throw { code: 'VALIDATION_ERROR', message: 'agentId is required for agent knowledge' }
  if (scope === 'room' && !input.roomId) throw { code: 'VALIDATION_ERROR', message: 'roomId is required for room knowledge' }
  return { ...input, scope, title, content, tags: input.tags || [] }
}

export class KnowledgeService {
  async assertCanManage(user: any, input: { scope: KnowledgeScope; agentId?: string; roomId?: string }) {
    if (input.scope === 'public') {
      if (user.role !== 'admin') throw { code: 'FORBIDDEN', message: 'Only admins can manage public knowledge' }
      return
    }
    if (input.scope === 'agent') {
      const agent = db.prepare('SELECT owner_id FROM agents WHERE id = ?').get(input.agentId) as any
      if (!agent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
      if (agent.owner_id !== user.id && user.role !== 'admin') throw { code: 'FORBIDDEN', message: 'Only agent owner can manage agent knowledge' }
      return
    }
    if (input.scope === 'room') {
      const member = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(input.roomId, user.id) as any
      if (!member && user.role !== 'admin') throw { code: 'FORBIDDEN', message: 'Not a room member' }
      if (member && !['owner', 'admin', 'editor'].includes(member.role)) throw { code: 'FORBIDDEN', message: 'Only room editors can manage room knowledge' }
    }
  }

  async list(user: any, filter: any = {}) {
    const scope = filter.scope as KnowledgeScope | undefined
    const values: any[] = []
    const where = [`status != 'deleted'`]
    if (scope) { where.push('scope = ?'); values.push(scope) }
    if (filter.agentId) { where.push('agent_id = ?'); values.push(filter.agentId) }
    if (filter.roomId) { where.push('room_id = ?'); values.push(filter.roomId) }
    if (filter.q) { where.push('(title LIKE ? OR content LIKE ? OR tags LIKE ?)'); const q = `%${filter.q}%`; values.push(q, q, q) }
    if (scope === 'agent') await this.assertCanManage(user, { scope: 'agent', agentId: filter.agentId })
    else if (scope === 'room') {
      const isMember = await roomService.isMember(filter.roomId, user.id)
      if (!isMember && user.role !== 'admin') throw { code: 'FORBIDDEN', message: 'Not a room member' }
    } else if (scope === 'public') {
      // visible to signed-in users; writes remain admin-only
    } else {
      where.push(`(scope = 'public' OR created_by = ? OR owner_user_id = ? OR room_id IN (SELECT room_id FROM room_members WHERE user_id = ?))`)
      values.push(user.id, user.id, user.id)
    }
    const rows = db.prepare(`SELECT * FROM knowledge_entries WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`).all(...values, Math.min(Number(filter.limit) || 100, 200)) as any[]
    return rows.map(rowToEntry)
  }

  async create(user: any, input: KnowledgeInput) {
    const item = normalizeInput(input)
    await this.assertCanManage(user, item)
    const now = Date.now()
    const id = `kb_${uuidv4()}`
    let ownerUserId = user.id
    if (item.scope === 'agent') {
      const row = db.prepare('SELECT owner_id FROM agents WHERE id = ?').get(item.agentId) as any
      ownerUserId = row?.owner_id || user.id
    }
    db.prepare(`INSERT INTO knowledge_entries (id, scope, owner_user_id, agent_id, room_id, title, content, tags, source_type, source_file_id, visibility, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, item.scope, ownerUserId, item.agentId || null, item.roomId || null, item.title, item.content, JSON.stringify(item.tags || []), item.sourceType || 'manual', item.sourceFileId || null, item.visibility || (item.scope === 'public' ? 'shared' : 'private'), user.id, user.id, now, now)
    return rowToEntry(db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(id))
  }

  async update(user: any, id: string, patch: Partial<KnowledgeInput>) {
    const row = db.prepare('SELECT * FROM knowledge_entries WHERE id = ? AND status != ?').get(id, 'deleted') as any
    if (!row) throw { code: 'KNOWLEDGE_NOT_FOUND', message: 'Knowledge entry not found' }
    await this.assertCanManage(user, { scope: row.scope, agentId: row.agent_id, roomId: row.room_id })
    const title = patch.title !== undefined ? String(patch.title).trim() : row.title
    const content = patch.content !== undefined ? String(patch.content).trim() : row.content
    if (!title || !content) throw { code: 'VALIDATION_ERROR', message: 'title and content are required' }
    const tags = patch.tags !== undefined ? JSON.stringify(patch.tags || []) : row.tags
    db.prepare('UPDATE knowledge_entries SET title = ?, content = ?, tags = ?, visibility = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(title, content, tags, patch.visibility || row.visibility, user.id, Date.now(), id)
    return rowToEntry(db.prepare('SELECT * FROM knowledge_entries WHERE id = ?').get(id))
  }

  async remove(user: any, id: string) {
    const row = db.prepare('SELECT * FROM knowledge_entries WHERE id = ? AND status != ?').get(id, 'deleted') as any
    if (!row) return
    await this.assertCanManage(user, { scope: row.scope, agentId: row.agent_id, roomId: row.room_id })
    db.prepare("UPDATE knowledge_entries SET status = 'deleted', updated_by = ?, updated_at = ? WHERE id = ?").run(user.id, Date.now(), id)
  }

  getRuntimeContext(roomId: string, agentId: string, input: string, limit = 8): string {
    const terms = Array.from(new Set(String(input || '').split(/[\s,，。；;：:\n]+/).map((x) => x.trim()).filter((x) => x.length >= 2))).slice(0, 8)
    const values: any[] = [roomId, agentId]
    let scoreSql = '0'
    for (const term of terms) {
      scoreSql += ' + CASE WHEN title LIKE ? OR content LIKE ? OR tags LIKE ? THEN 1 ELSE 0 END'
      const q = `%${term}%`; values.push(q, q, q)
    }
    const rows = db.prepare(`SELECT *, (${scoreSql}) as score FROM knowledge_entries WHERE status = 'active' AND (scope = 'public' OR (scope = 'room' AND room_id = ?) OR (scope = 'agent' AND agent_id = ?)) ORDER BY score DESC, updated_at DESC LIMIT ?`).all(...values.slice(2), roomId, agentId, limit) as any[]
    const entries = rows.filter((row) => row.score > 0 || rows.length <= 4).slice(0, limit).map(rowToEntry)
    if (!entries.length) return ''
    return ['【可参考知识库】', ...entries.map((item: any, index) => `#${index + 1} [${item.scope}] ${item.title}\n${item.content.slice(0, 1200)}`)].join('\n\n')
  }
}

export const knowledgeService = new KnowledgeService()
