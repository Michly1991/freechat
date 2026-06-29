import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-inline-tool-guard-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'
process.env.DISABLE_CONVERSATION_MEMORY_HOOKS = '1'

const { default: db, initDatabase } = await import('../storage/db.js')
const { messageService } = await import('../services/message.service.js')
const { completeRemoteRun } = await import('../services/remote-agent-run-settlement.service.js')
const { sanitizeAiCompletionForChat, stripInlineToolMarkup, extractInlineToolCalls } = await import('../services/inline-tool-markup.js')

const now = Date.now()
try {
  initDatabase()
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'x', 'Owner', 'user', 'human', now, now)
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('room', 'Room', 'owner', now, now, now)
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run('room', 'owner', 'owner', 'human', now)
  db.prepare('INSERT INTO agents (id, owner_id, name, role_type, deployment, description, specialties, config, status, is_template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('agent', 'owner', 'Agent', 'assistant', 'client', null, null, '{}', 'active', 1, now, now)
  db.prepare('INSERT INTO room_agents (room_id, agent_id, added_by, added_at, room_role, auto_enabled, priority) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('room', 'agent', 'owner', now, 'assistant', 1, 0)
  db.prepare("INSERT INTO agent_connectors (id, agent_id, owner_id, instance_id, name, status, created_at) VALUES (?, ?, ?, ?, ?, 'online', ?)")
    .run('connector', 'agent', 'owner', 'test', 'test', now)
  db.prepare("INSERT INTO agent_connector_tokens (id, connector_id, token_hash, token_prefix, status, last_used_at, created_at) VALUES (?, ?, ?, ?, 'active', ?, ?)")
    .run('token', 'connector', 'hash', 'prefix', now, now)

  const leaked = '我来帮你分析这份志愿表。先读取一下文件内容。<toolcall>{"name":"excel.read","args":{"fileId":"file_123","range":"全部"}}</toolcall>'
  const leakedOpen = '我来帮你分析这份志愿表。先读取一下文件内容。<toolcall>{"name":"excel.read","args":{"fileId":"file_123","range":"全部"}}'
  assert.equal(extractInlineToolCalls(leaked)[0]?.name, 'excel.read')
  assert.equal(extractInlineToolCalls(leakedOpen)[0]?.name, 'excel.read')
  assert.equal(stripInlineToolMarkup(leaked), '我来帮你分析这份志愿表。先读取一下文件内容。')
  assert.equal(stripInlineToolMarkup(leakedOpen), '我来帮你分析这份志愿表。先读取一下文件内容。')
  assert.equal(sanitizeAiCompletionForChat(leaked), '')

  const msg = await messageService.createMessage('room', 'agent', 'Agent', 'ai', leaked)
  assert.equal(msg.content, '')
  const stored = db.prepare('SELECT content FROM messages WHERE id = ?').get(msg.id) as any
  assert.equal(stored.content, '')

  const finalWithLeak = '已读完文件。<toolcall>{"name":"excel.read","args":{"fileId":"file_123"}}</toolcall>志愿表里共有 3 位候选人。'
  const cleanMsg = await messageService.createMessage('room', 'agent', 'Agent', 'ai', finalWithLeak)
  assert.equal(cleanMsg.content, '已读完文件。志愿表里共有 3 位候选人。')

  db.prepare("INSERT INTO agent_runs (id, room_id, agent_id, status, input, actor_user_id, payer_user_id, run_source, runtime, started_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)")
    .run('run', 'room', 'agent', 'input', 'owner', 'owner', 'agent.mentioned', 'remote-claude-code', now)
  db.prepare('INSERT INTO remote_agent_events (id, run_id, room_id, agent_id, type, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('evt', 'run', 'room', 'agent', 'agent.mentioned', '{}', 'delivered', now)
  completeRemoteRun({ connectorId: 'connector', agentId: 'agent', ownerId: 'owner', tokenId: 'token' }, 'run', { output: leaked, responseMode: 'final_to_chat', usage: { totalTokens: 0 }, __skipAsyncHooks: true })
  const leakedMessages = db.prepare("SELECT * FROM messages WHERE content LIKE '%<toolcall>%' OR content LIKE '%excel.read%'").all() as any[]
  assert.equal(leakedMessages.length, 0)
  const run = db.prepare('SELECT output, status FROM agent_runs WHERE id = ?').get('run') as any
  assert.match(run.output, /<toolcall>/)
  assert.equal(run.status, 'succeeded')

  console.log('inline tool markup guard smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
