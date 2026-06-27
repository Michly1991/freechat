import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-message-attachment-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { registerMessageRoutes } = await import('../routes/messages.js')
const { generateToken } = await import('../auth/jwt.js')
const { roomFileService } = await import('../services/room-file.service.js')
const Fastify = (await import('fastify')).default
const multipart = (await import('@fastify/multipart')).default

const now = Date.now()
try {
  initDatabase()
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'x', 'Owner', 'user', 'human', now, now)
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('room', 'Room', 'owner', now, now, now)
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run('room', 'owner', 'owner', 'human', now)

  const app = Fastify({ logger: false })
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 } })
  app.addHook('preHandler', async (request) => { (request as any).user = { id: 'owner', username: 'owner', nickname: 'Owner', role: 'user' } })
  await registerMessageRoutes(app)

  const token = generateToken({ id: 'owner', username: 'owner', nickname: 'Owner', role: 'user', identityType: 'human', createdAt: now, updatedAt: now } as any)
  const form = new FormData()
  form.append('content', '请看附件 @助理')
  form.append('mentions', JSON.stringify([{ id: 'agent', name: '助理', role: 'ai' }]))
  form.append('files', new File([Buffer.from('demo content')], 'demo.txt', { type: 'text/plain' }))
  const res = await app.inject({ method: 'POST', url: '/api/rooms/room/messages/with-files', headers: { authorization: `Bearer ${token}` }, body: form as any })
  assert.equal(res.statusCode, 200, res.body)
  const data = res.json().data
  assert.equal(data.message.content, '请看附件 @助理')
  assert.equal(data.message.attachments.length, 1)
  assert.equal(data.message.attachments[0].name, 'demo.txt')
  assert.equal(data.message.attachments[0].source, 'message_attachment')
  assert.deepEqual(data.message.mentions, [{ id: 'agent', name: '助理', role: 'ai' }])

  const stored = roomFileService.resolveRef('room', data.message.attachments[0].ref)
  assert.equal(stored.message_id, data.message.id)
  const fullPath = join(temp, 'workspace', 'room', 'files', stored.storage_path)
  assert.equal(readFileSync(fullPath, 'utf8'), 'demo content')

  await app.close()
  console.log('message attachment upload smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
