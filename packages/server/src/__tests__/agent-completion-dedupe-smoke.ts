import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-agent-complete-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { completeRemoteRun } = await import('../services/remote-agent-run-settlement.service.js')

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
  db.prepare("INSERT INTO agent_runs (id, room_id, agent_id, status, input, actor_user_id, payer_user_id, run_source, runtime, started_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)")
    .run('run', 'room', 'agent', 'input', 'owner', 'owner', 'agent.mentioned', 'remote-claude-code', now)
  db.prepare('INSERT INTO remote_agent_events (id, run_id, room_id, agent_id, type, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('evt', 'run', 'room', 'agent', 'agent.mentioned', '{}', 'delivered', now)

  db.prepare('INSERT INTO messages (id, room_id, actor_id, actor_name, actor_role, content, mentions, created_at, kind, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .run('existing', 'room', 'agent', 'Agent', 'ai', 'same final answer', '[]', now + 1, 'text')

  completeRemoteRun({ connectorId: 'connector', agentId: 'agent', ownerId: 'owner', tokenId: 'token' }, 'run', { output: 'same final answer', responseMode: 'final_to_chat', usage: { totalTokens: 0 } })

  const messages = db.prepare("SELECT id FROM messages WHERE room_id = ? AND actor_id = ? AND content = ?").all('room', 'agent', 'same final answer') as any[]
  assert.equal(messages.length, 1)
  assert.equal((db.prepare('SELECT status FROM agent_runs WHERE id = ?').get('run') as any)?.status, 'succeeded')
  console.log('agent completion dedupe smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
