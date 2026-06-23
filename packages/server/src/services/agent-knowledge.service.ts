import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'

export type AgentKnowledgeFileInput = {
  name?: string
  path?: string
  content?: string
  mimeType?: string
}

function safePath(input: string) {
  const raw = String(input || '').replace(/\\/g, '/').trim()
  const parts = raw.split('/').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) throw { code: 'VALIDATION_ERROR', message: 'path is required' }
  if (parts.some((part) => part === '.' || part === '..' || /[\x00-\x1f]/.test(part))) throw { code: 'VALIDATION_ERROR', message: 'invalid path' }
  return parts.join('/')
}

function nameFromPath(path: string) {
  return path.split('/').filter(Boolean).pop() || path
}

function checksum(content: string) {
  return crypto.createHash('sha256').update(content || '').digest('hex')
}

function rowToFile(row: any) {
  return row ? {
    id: row.id,
    agentId: row.agent_id,
    ownerUserId: row.owner_user_id,
    name: row.name,
    path: row.path,
    mimeType: row.mime_type,
    content: row.content,
    size: row.size || 0,
    checksum: row.checksum,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null
}

export class AgentKnowledgeService {
  list(agentId: string, includeContent = false) {
    const rows = db.prepare(`
      SELECT * FROM agent_knowledge_files
      WHERE agent_id = ? AND deleted_at IS NULL
      ORDER BY path ASC
    `).all(agentId) as any[]
    const files = rows.map((row) => {
      const file = rowToFile(row)
      if (!includeContent && file) delete (file as any).content
      return file
    })
    const index = db.prepare('SELECT * FROM agent_knowledge_indexes WHERE agent_id = ?').get(agentId) as any
    return {
      agentId,
      files,
      summary: {
        fileCount: files.length,
        totalSize: files.reduce((sum: number, file: any) => sum + Number(file?.size || 0), 0),
        lastUpdatedAt: files.reduce((max: number, file: any) => Math.max(max, Number(file?.updatedAt || 0)), 0) || null,
        lastIndexedAt: index?.last_indexed_at || null,
        indexStatus: index?.status || 'empty',
        errorMessage: index?.error_message || null,
      },
    }
  }

  get(agentId: string, fileId: string) {
    const row = db.prepare('SELECT * FROM agent_knowledge_files WHERE id = ? AND agent_id = ? AND deleted_at IS NULL').get(fileId, agentId) as any
    if (!row) throw { code: 'KNOWLEDGE_FILE_NOT_FOUND', message: 'Knowledge file not found' }
    return rowToFile(row)
  }

  upsert(agentId: string, ownerUserId: string, input: AgentKnowledgeFileInput, updatedBy: string) {
    const path = safePath(input.path || input.name || '')
    const name = String(input.name || nameFromPath(path)).trim() || nameFromPath(path)
    const content = String(input.content || '')
    const now = Date.now()
    const existing = db.prepare('SELECT id FROM agent_knowledge_files WHERE agent_id = ? AND path = ? AND deleted_at IS NULL').get(agentId, path) as any
    if (existing?.id) {
      db.prepare(`
        UPDATE agent_knowledge_files
        SET name = ?, mime_type = ?, content = ?, size = ?, checksum = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND agent_id = ?
      `).run(name, input.mimeType || guessMime(path), content, Buffer.byteLength(content), checksum(content), updatedBy, now, existing.id, agentId)
      this.touchIndex(agentId, 'stale')
      return this.get(agentId, existing.id)
    }
    const id = `akf_${uuidv4()}`
    db.prepare(`
      INSERT INTO agent_knowledge_files (id, agent_id, owner_user_id, name, path, mime_type, content, size, checksum, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, agentId, ownerUserId, name, path, input.mimeType || guessMime(path), content, Buffer.byteLength(content), checksum(content), updatedBy, updatedBy, now, now)
    this.touchIndex(agentId, 'stale')
    return this.get(agentId, id)
  }

  update(agentId: string, fileId: string, input: AgentKnowledgeFileInput, updatedBy: string) {
    const current = this.get(agentId, fileId) as any
    const nextPath = input.path !== undefined || input.name !== undefined ? safePath(input.path || input.name || current.path) : current.path
    const nextName = String(input.name || nameFromPath(nextPath)).trim() || nameFromPath(nextPath)
    const nextContent = input.content !== undefined ? String(input.content || '') : current.content
    const now = Date.now()
    const conflict = db.prepare('SELECT id FROM agent_knowledge_files WHERE agent_id = ? AND path = ? AND deleted_at IS NULL AND id != ?').get(agentId, nextPath, fileId) as any
    if (conflict) throw { code: 'VALIDATION_ERROR', message: '同路径知识文件已存在' }
    db.prepare(`
      UPDATE agent_knowledge_files
      SET name = ?, path = ?, mime_type = ?, content = ?, size = ?, checksum = ?, updated_by = ?, updated_at = ?
      WHERE id = ? AND agent_id = ? AND deleted_at IS NULL
    `).run(nextName, nextPath, input.mimeType || current.mimeType || guessMime(nextPath), nextContent, Buffer.byteLength(nextContent), checksum(nextContent), updatedBy, now, fileId, agentId)
    this.touchIndex(agentId, 'stale')
    return this.get(agentId, fileId)
  }

  delete(agentId: string, fileId: string, updatedBy: string) {
    this.get(agentId, fileId)
    db.prepare('UPDATE agent_knowledge_files SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ? AND agent_id = ?').run(Date.now(), updatedBy, Date.now(), fileId, agentId)
    this.touchIndex(agentId, 'stale')
  }

  reindex(agentId: string) {
    const list = this.list(agentId, false)
    const now = Date.now()
    db.prepare(`
      INSERT INTO agent_knowledge_indexes (agent_id, status, file_count, total_size, last_indexed_at, error_message, updated_at)
      VALUES (?, 'ready', ?, ?, ?, NULL, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        status = excluded.status,
        file_count = excluded.file_count,
        total_size = excluded.total_size,
        last_indexed_at = excluded.last_indexed_at,
        error_message = NULL,
        updated_at = excluded.updated_at
    `).run(agentId, list.summary.fileCount, list.summary.totalSize, now, now)
    return this.list(agentId, false)
  }

  private touchIndex(agentId: string, status: string) {
    const list = this.list(agentId, false)
    db.prepare(`
      INSERT INTO agent_knowledge_indexes (agent_id, status, file_count, total_size, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET status = excluded.status, file_count = excluded.file_count, total_size = excluded.total_size, updated_at = excluded.updated_at
    `).run(agentId, status, list.summary.fileCount, list.summary.totalSize, Date.now())
  }
}

function guessMime(path: string) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.md')) return 'text/markdown'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.csv')) return 'text/csv'
  return 'text/plain'
}

export const agentKnowledgeService = new AgentKnowledgeService()
