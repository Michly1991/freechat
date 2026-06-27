import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-room-upload-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { roomFileService } = await import('../services/room-file.service.js')

const now = Date.now()
try {
  initDatabase()
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'x', 'Owner', 'user', 'human', now, now)
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('room', 'Room', 'owner', now, now, now)

  const multipartFile = {
    filename: 'demo.txt',
    mimetype: 'text/plain',
    async toBuffer() { return Buffer.from('hello upload', 'utf8') },
  }
  const record = await roomFileService.uploadProjectFile('room', multipartFile, 'docs/demo.txt', 'owner', true)

  assert.equal(record.name, 'demo.txt')
  assert.equal(record.relativePath, 'docs/demo.txt')
  assert.equal(record.source, 'upload')
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM room_file_folders WHERE room_id = ? AND relative_path = ?').get('room', 'docs') as any)?.count, 1)
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM room_files WHERE room_id = ? AND relative_path = ?').get('room', 'docs/demo.txt') as any)?.count, 1)
  assert.equal(await readFile(join(temp, 'workspace', 'room', 'files', 'docs', 'demo.txt'), 'utf8'), 'hello upload')
  console.log('room file upload smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
