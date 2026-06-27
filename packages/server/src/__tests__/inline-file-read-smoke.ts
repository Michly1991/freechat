import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-inline-file-read-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { agentService } = await import('../services/agent.service.js')
const { roomFileService } = await import('../services/room-file.service.js')
const { executeInlineToolCalls } = await import('../services/inline-agent-tool.service.js')

const now = Date.now()
try {
  initDatabase()
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'x', 'Owner', 'user', 'human', now, now)
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('room', 'Room', 'owner', now, now, now)
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run('room', 'owner', 'owner', 'human', now)
  const created = await agentService.createAgent('owner', {
    name: '小蜜',
    roleType: 'assistant',
    deployment: 'server',
    description: 'assistant',
    specialties: [],
    config: { builtInKey: 'xiaomi_assistant' } as any,
  })
  await agentService.addAgentToRoom('room', created.agent.id, 'owner', { roomRole: 'assistant', autoEnabled: true })

  const attachment = await roomFileService.createMessageAttachment('room', 'msg1', {
    filename: '合同.txt',
    mimetype: 'text/plain',
    toBuffer: async () => Buffer.from('合同金额：12345 元'),
  }, 'owner')

  const summary = await executeInlineToolCalls('room', created.agent.id, 'owner', `<toolcall>{"name":"file.read","args":{"ref":"${attachment.ref}"}}</toolcall>`)
  assert.match(summary || '', /合同\.txt/)
  assert.match(summary || '', /合同金额：12345 元/)

  const appSummary = await executeInlineToolCalls('room', created.agent.id, 'owner', `<toolcall>{"name":"app.call","args":{"action":"file.read","args":{"ref":"${attachment.ref}"}}}</toolcall>`)
  assert.match(appSummary || '', /合同金额：12345 元/)

  console.log('inline file read smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
