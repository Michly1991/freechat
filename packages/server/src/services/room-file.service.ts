import { createReadStream } from 'fs'
import { copyFile, mkdir, stat, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { config } from '../config.js'
import { safeRelativePath, assertProjectFilePathAllowed } from '../routes/agent-tools.helpers.js'

export interface RoomFileRecord {
  id: string
  ref: string
  roomId: string
  folderId: string
  name: string
  relativePath: string
  mimeType?: string
  size: number
  source: string
  messageId?: string
  createdAt: number
}

function cleanFilename(input = 'upload.bin') {
  return basename(input).replace(/[\\/:*?"<>|]/g, '_').trim() || 'upload.bin'
}

function folderNameFromPath(path: string) {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || 'files'
}

function rowToFile(row: any): RoomFileRecord {
  return {
    id: row.id,
    ref: `file:${row.id}`,
    roomId: row.room_id,
    folderId: row.folder_id,
    name: row.name,
    relativePath: row.relative_path,
    mimeType: row.mime_type || undefined,
    size: row.size || 0,
    source: row.source,
    messageId: row.message_id || undefined,
    createdAt: row.created_at,
  }
}

export class RoomFileService {
  resolveRef(roomId: string, refOrPath: string): any {
    const raw = String(refOrPath || '').trim()
    if (!raw) throw { code: 'VALIDATION_ERROR', message: 'file ref/path is required' }
    if (raw.startsWith('file:')) {
      const id = raw.slice('file:'.length)
      const row = db.prepare('SELECT * FROM room_files WHERE room_id = ? AND id = ?').get(roomId, id) as any
      if (!row) throw { code: 'FILE_NOT_FOUND', message: 'File not found in current room' }
      return row
    }
    const rel = safeRelativePath(raw)
    const row = db.prepare('SELECT * FROM room_files WHERE room_id = ? AND relative_path = ?').get(roomId, rel) as any
    if (row) return row
    return { id: null, room_id: roomId, relative_path: rel, storage_path: rel, name: basename(rel), folder_id: null }
  }

  ensureFolder(roomId: string, relativePath: string, kind = 'project', createdBy?: string, sourceMessageId?: string): string {
    const rel = safeRelativePath(relativePath).replace(/\/$/, '')
    const now = Date.now()
    const existing = db.prepare('SELECT id FROM room_file_folders WHERE room_id = ? AND relative_path = ?').get(roomId, rel) as any
    if (existing?.id) return existing.id
    const id = `folder_${uuidv4()}`
    db.prepare(`
      INSERT INTO room_file_folders (id, room_id, name, relative_path, kind, source_message_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, roomId, folderNameFromPath(rel), rel, kind, sourceMessageId || null, createdBy || null, now, now)
    return id
  }

  async createMessageAttachment(roomId: string, messageId: string, file: any, uploadedBy: string): Promise<RoomFileRecord> {
    const name = cleanFilename(file.filename)
    const folderPath = `message-files/${messageId}`
    const folderId = this.ensureFolder(roomId, folderPath, 'message', uploadedBy, messageId)
    const rel = safeRelativePath(`${folderPath}/${name}`)
    const fullPath = join(config.workspace.root, roomId, 'files', rel)
    await mkdir(dirname(fullPath), { recursive: true })
    const buffer = await file.toBuffer()
    await writeFile(fullPath, buffer)
    return this.upsertFileRecord({ roomId, folderId, name, rel, storagePath: rel, mimeType: file.mimetype, size: buffer.length, source: 'message_attachment', messageId, uploadedBy })
  }

  async uploadProjectFile(roomId: string, file: any, targetPath: string, uploadedBy: string, addToTab = false): Promise<RoomFileRecord> {
    const rel = safeRelativePath(targetPath || cleanFilename(file.filename))
    assertProjectFilePathAllowed(rel)
    const folderRel = dirname(rel) === '.' ? 'files' : dirname(rel)
    const folderId = this.ensureFolder(roomId, folderRel, 'project', uploadedBy)
    const fullPath = join(config.workspace.root, roomId, 'files', rel)
    await mkdir(dirname(fullPath), { recursive: true })
    const buffer = await file.toBuffer()
    await writeFile(fullPath, buffer)
    const record = this.upsertFileRecord({ roomId, folderId, name: basename(rel), rel, storagePath: rel, mimeType: file.mimetype, size: buffer.length, source: 'upload', uploadedBy })
    return record
  }

  async promote(roomId: string, ref: string, targetPath: string, actorId: string): Promise<RoomFileRecord> {
    const source = this.resolveRef(roomId, ref)
    if (!source.id) throw { code: 'FILE_NOT_FOUND', message: 'File not found in current room' }
    const rel = safeRelativePath(targetPath)
    assertProjectFilePathAllowed(rel)
    const folderRel = dirname(rel) === '.' ? 'files' : dirname(rel)
    const folderId = this.ensureFolder(roomId, folderRel, 'project', actorId)
    const src = join(config.workspace.root, roomId, 'files', source.storage_path)
    const dst = join(config.workspace.root, roomId, 'files', rel)
    await mkdir(dirname(dst), { recursive: true })
    await copyFile(src, dst)
    const info = await stat(dst)
    return this.upsertFileRecord({ roomId, folderId, name: basename(rel), rel, storagePath: rel, mimeType: source.mime_type, size: info.size, source: 'promoted_attachment', sourceFileId: source.id, uploadedBy: actorId })
  }

  streamForRef(roomId: string, refOrPath: string) {
    const row = this.resolveRef(roomId, refOrPath)
    const fullPath = join(config.workspace.root, roomId, 'files', row.storage_path || row.relative_path)
    return { row, stream: createReadStream(fullPath) }
  }

  list(roomId: string, opts: { messageId?: string } = {}) {
    const folders = db.prepare('SELECT * FROM room_file_folders WHERE room_id = ? ORDER BY relative_path ASC').all(roomId)
    const files = opts.messageId
      ? db.prepare('SELECT * FROM room_files WHERE room_id = ? AND message_id = ? ORDER BY created_at ASC').all(roomId, opts.messageId)
      : db.prepare('SELECT * FROM room_files WHERE room_id = ? ORDER BY created_at DESC').all(roomId)
    return { folders, files: (files as any[]).map(rowToFile) }
  }

  private upsertFileRecord(input: { roomId: string; folderId: string; name: string; rel: string; storagePath: string; mimeType?: string; size: number; source: string; sourceFileId?: string; messageId?: string; uploadedBy?: string }): RoomFileRecord {
    const id = `file_${uuidv4()}`
    const now = Date.now()
    db.prepare(`
      INSERT INTO room_files (id, room_id, folder_id, name, relative_path, storage_path, mime_type, size, sha256, source, source_file_id, message_id, uploaded_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id, relative_path) DO UPDATE SET
        folder_id = excluded.folder_id,
        name = excluded.name,
        storage_path = excluded.storage_path,
        mime_type = excluded.mime_type,
        size = excluded.size,
        source = excluded.source,
        source_file_id = excluded.source_file_id,
        message_id = excluded.message_id,
        uploaded_by = excluded.uploaded_by,
        updated_at = excluded.updated_at
    `).run(id, input.roomId, input.folderId, input.name, input.rel, input.storagePath, input.mimeType || null, input.size, input.source, input.sourceFileId || null, input.messageId || null, input.uploadedBy || null, now, now)
    const row = db.prepare('SELECT * FROM room_files WHERE room_id = ? AND relative_path = ?').get(input.roomId, input.rel) as any
    return rowToFile(row)
  }
}

export const roomFileService = new RoomFileService()
