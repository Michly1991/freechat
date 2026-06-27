import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-remote-app-call-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { agentService } = await import('../services/agent.service.js')
const { remoteAgentConnectorService } = await import('../services/remote-agent-connector.service.js')
const { executeRemoteAppCall } = await import('../routes/remote-agent-app-call.js')

const now = Date.now()
try {
  initDatabase()
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'x', 'Owner', 'user', 'human', now, now)
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('actor', 'actor', 'x', 'Actor', 'user', 'human', now, now)
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('room', 'Room', 'actor', now, now, now)
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)').run('room', 'actor', 'owner', 'human', now)
  const created = await agentService.createAgent('owner', { name: '远程Agent', roleType: 'assistant', deployment: 'client', description: 'remote', specialties: [], config: {} as any })
  db.prepare('INSERT INTO room_agents (room_id, agent_id, added_by, added_at, room_role, auto_enabled, priority) VALUES (?, ?, ?, ?, ?, ?, ?)').run('room', created.agent.id, 'actor', now, 'assistant', 1, 0)
  const connectorId = 'aconn_test', tokenId = 'actok_test'
  db.prepare("INSERT INTO agent_connectors (id, agent_id, owner_id, instance_id, name, status, created_at) VALUES (?, ?, ?, ?, ?, 'online', ?)").run(connectorId, created.agent.id, 'owner', 'test', 'test connector', now)
  db.prepare("INSERT INTO agent_connector_tokens (id, connector_id, token_hash, token_prefix, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)").run(tokenId, connectorId, 'x', 'x', now)
  db.prepare("INSERT INTO agent_runs (id, room_id, agent_id, status, input, actor_user_id, payer_user_id, run_source, runtime, started_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?, ?)")
    .run('run', 'room', created.agent.id, 'input', 'actor', 'actor', 'agent.mentioned', 'remote-claude-code', now)

  const auth = { connectorId, agentId: created.agent.id, ownerId: 'owner', tokenId }
  const listed = await executeRemoteAppCall(auth, { roomId: 'room', runId: 'run', action: 'app.call', args: { action: 'billing.account', args: {} } })
  assert.equal(listed.success, true)
  assert.ok(listed.data.account)

  const sent = await executeRemoteAppCall(auth, { roomId: 'room', runId: 'run', action: 'chat.send', args: { content: 'HTTP 接入正常' } })
  assert.equal(sent.success, true)
  const msg = db.prepare('SELECT actor_id, content FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT 1').get('room') as any
  assert.equal(msg.actor_id, created.agent.id)
  assert.equal(msg.content, 'HTTP 接入正常')

  await assert.rejects(executeRemoteAppCall(auth, { action: 'chat.send', args: { content: 'no room' } }), (err: any) => err?.code === 'VALIDATION_ERROR' && /roomId is required/.test(err?.message || ''))
  console.log('remote app call smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
