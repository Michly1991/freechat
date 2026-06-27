import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-agent-model-global-'))
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
function agent(id: string, ownerId: string, sourceTemplateId: string | null = null) {
  db.prepare('INSERT INTO agents (id, owner_id, name, role_type, deployment, description, specialties, config, status, is_template, source_template_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ownerId, id, 'assistant', 'client', null, null, '{}', 'active', sourceTemplateId ? 0 : 1, sourceTemplateId, now, now)
}
function room(id: string, ownerId: string, agentId: string) {
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, id, ownerId, now, now, now)
  db.prepare('INSERT INTO room_agents (room_id, agent_id, added_by, added_at, room_role, auto_enabled, priority) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, agentId, ownerId, now, 'assistant', 1, 0)
}

try {
  initDatabase()
  user('owner')
  user('payer_a')
  user('payer_b')
  agent('agent_template', 'owner')
  agent('agent_clone_a', 'payer_a', 'agent_template')
  agent('agent_clone_b', 'payer_b', 'agent_template')
  room('room_a', 'payer_a', 'agent_clone_a')
  room('room_b', 'payer_b', 'agent_clone_b')
  profile('mp_v1', 'owner', 'model-v1', 'shared')
  profile('mp_v2', 'owner', 'model-v2', 'shared')

  agentModelConfigService.updateAgentDefault('agent_template', { modelProfileId: 'mp_v1', model: 'model-v1', runtime: 'claude-code', allowPaidSharedModel: true }, 'owner')
  assert.equal(modelRuntimeService.resolveRoomAgentModel('room_a', 'agent_clone_a', 'payer_a').model, 'model-v1')
  assert.equal(modelRuntimeService.resolveRoomAgentModel('room_b', 'agent_clone_b', 'payer_b').model, 'model-v1')

  agentModelConfigService.updateAgentDefault('agent_template', { modelProfileId: 'mp_v2', model: 'model-v2', runtime: 'claude-code', allowPaidSharedModel: true }, 'owner')
  assert.equal(modelRuntimeService.resolveRoomAgentModel('room_a', 'agent_clone_a', 'payer_a').model, 'model-v2')
  assert.equal(modelRuntimeService.resolveRoomAgentModel('room_b', 'agent_clone_b', 'payer_b').model, 'model-v2')

  profile('mp_override', 'payer_a', 'own-model', 'private')
  agentModelConfigService.updateRoomOverride('room_a', 'agent_clone_a', { modelProfileId: 'mp_override', model: 'own-model', runtime: 'claude-code' }, 'payer_a')
  assert.equal(modelRuntimeService.resolveRoomAgentModel('room_a', 'agent_clone_a', 'payer_a').model, 'own-model')
  assert.equal(modelRuntimeService.resolveRoomAgentModel('room_b', 'agent_clone_b', 'payer_b').model, 'model-v2')

  console.log('agent global model default smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
