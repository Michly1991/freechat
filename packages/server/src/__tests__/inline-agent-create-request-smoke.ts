import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-inline-agent-create-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { agentService } = await import('../services/agent.service.js')
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

  const detailOutput = '<toolcall>{"name":"agent.detail","args":{}}</toolcall>'
  const detailSummary = await executeInlineToolCalls('room', created.agent.id, 'owner', detailOutput)
  assert.match(detailSummary || '', /Agent：小蜜/)
  assert.doesNotMatch(detailSummary || '', /apiKey|api_key|hash|password/i)

  const output = '<toolcall>{"name":"agent.create","args":{"name":"金牌律师","description":"文件处理","specialties":["文件处理"],"roleType":"specialist"}}</toolcall>'
  const summary = await executeInlineToolCalls('room', created.agent.id, 'owner', output)

  assert.match(summary || '', /确认创建 Agent：金牌律师|已创建确认卡/)
  const interaction = db.prepare('SELECT * FROM interaction_requests WHERE room_id = ? AND type = ?').get('room', 'confirm') as any
  assert.ok(interaction)
  const payload = JSON.parse(interaction.payload_json)
  assert.equal(payload.agentCreate.name, '金牌律师')
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM messages WHERE room_id = ? AND kind = ?').get('room', 'interaction_request') as any)?.count, 1)
  console.log('inline agent create request smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
