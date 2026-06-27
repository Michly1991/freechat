import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-agent-model-default-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')

const { default: db, initDatabase } = await import('../storage/db.js')
const { agentModelConfigService } = await import('../services/agent-model-config.service.js')
const { modelRuntimeService } = await import('../services/model-runtime.service.js')

const now = Date.now()
function user(id: string) {
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, id, 'x', id, 'user', 'human', now, now)
}
function profile(id: string, ownerId: string, model: string, visibility = 'shared') {
  db.prepare('INSERT INTO model_profiles (id, owner_id, name, provider_type, base_url, api_key_cipher, api_key_last4, default_model, models, visibility, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ownerId, id, 'anthropic-compatible', 'https://example.test', 'secret', 'cret', model, JSON.stringify([model]), visibility, 1, now, now)
}

try {
  initDatabase()
  user('owner')
  user('payer')
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)').run('room1', 'Room', 'payer', now, now, now)
  db.prepare('INSERT INTO agents (id, owner_id, name, role_type, deployment, description, specialties, config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('agent1', 'owner', 'A', 'assistant', 'client', null, null, '{}', 'active', now, now)
  db.prepare('INSERT INTO room_agents (room_id, agent_id, added_by, added_at, room_role, auto_enabled, priority) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('room1', 'agent1', 'payer', now, 'assistant', 1, 0)
  profile('mp_default', 'owner', 'seller-model', 'shared')
  profile('mp_override', 'payer', 'own-model', 'private')

  agentModelConfigService.updateAgentDefault('agent1', { modelProfileId: 'mp_default', model: 'seller-model', runtime: 'claude-code', allowPaidSharedModel: true }, 'owner')
  let effective = agentModelConfigService.getEffectiveConfig('room1', 'agent1')
  assert.equal(effective?.scope, 'agent_default')
  assert.equal(effective?.modelProfileId, 'mp_default')
  let runtime = modelRuntimeService.resolveRoomAgentModel('room1', 'agent1', 'payer')
  assert.equal(runtime.modelProfileId, 'mp_default')
  assert.equal(runtime.modelSource, 'marketplace')
  assert.equal(runtime.modelProviderUserId, 'owner')

  agentModelConfigService.updateRoomOverride('room1', 'agent1', { modelProfileId: 'mp_override', model: 'own-model', runtime: 'claude-code' }, 'payer')
  effective = agentModelConfigService.getEffectiveConfig('room1', 'agent1')
  assert.equal(effective?.scope, 'room_override')
  assert.equal(effective?.modelProfileId, 'mp_override')
  runtime = modelRuntimeService.resolveRoomAgentModel('room1', 'agent1', 'payer')
  assert.equal(runtime.modelProfileId, 'mp_override')
  assert.equal(runtime.modelSource, 'user_owned')
  assert.equal(runtime.modelProviderUserId, null)

  agentModelConfigService.updateRoomOverride('room1', 'agent1', {}, 'payer')
  effective = agentModelConfigService.getEffectiveConfig('room1', 'agent1')
  assert.equal(effective?.scope, 'agent_default')
  assert.equal(effective?.modelProfileId, 'mp_default')

  console.log('agent model default inheritance smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
