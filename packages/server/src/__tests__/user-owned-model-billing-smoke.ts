import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-user-model-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')

const { default: db, initDatabase } = await import('../storage/db.js')
const { billingRuleRepository } = await import('../domains/billing/billing-rule.repository.js')
const { nonNegativeCreditToMicro } = await import('../domains/billing/money.js')
const { billingService } = await import('../services/billing.service.js')

const now = Date.now()
function user(id: string) {
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, id, 'x', id, 'user', 'human', now, now)
}

try {
  initDatabase()
  user('payer')
  user('platform_provider')
  user('agent_owner')

  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('room_user_model', 'Room', 'payer', now, now, now)
  db.prepare('INSERT INTO agents (id, owner_id, name, role_type, deployment, description, specialties, config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('agent_user_model', 'agent_owner', '小蜜', 'assistant', 'client', null, null, JSON.stringify({ builtInKey: 'xiaomi_assistant' }), 'active', now, now)
  db.prepare('INSERT INTO room_agents (room_id, agent_id, added_by, room_role, auto_enabled, priority, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('room_user_model', 'agent_user_model', 'payer', 'assistant', 1, 0, now)
  db.prepare('INSERT INTO model_profiles (id, owner_id, name, provider_type, base_url, api_key_cipher, api_key_last4, default_model, models, visibility, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('mp_user_owned', 'payer', '我的模型', 'anthropic-compatible', 'https://example.test', 'secret', 'cret', 'own-model', JSON.stringify(['own-model']), 'private', 1, now, now)
  db.prepare('INSERT INTO room_agent_model_bindings (room_id, agent_id, model_profile_id, model, runtime, configured_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('room_user_model', 'agent_user_model', 'mp_user_owned', 'own-model', 'claude-code', 'payer', now)
  billingRuleRepository.upsertModelRule('mp_user_owned', 'own-model', { inputCreditPerMillion: 10000, outputCreditPerMillion: 20000, cacheWriteCreditPerMillion: 0, cacheReadCreditPerMillion: 0, minCreditsPerRun: 0, enabled: true }, nonNegativeCreditToMicro)
  billingRuleRepository.upsertAgentRule('agent_user_model', { billingMode: 'free', modelFreeRunsPerDay: 0 }, nonNegativeCreditToMicro)

  db.prepare(`
    INSERT INTO agent_runs (id, room_id, agent_id, status, input, runtime, model, input_tokens, output_tokens, total_tokens, payer_user_id, usage_source, usage_trust_level, raw_usage_json, started_at, finished_at)
    VALUES (?, ?, ?, 'succeeded', ?, 'platform-hosted-client', 'own-model', 1000, 1000, 2000, 'payer', 'server_metered', 'trusted', ?, ?, ?)
  `).run('run_user_model', 'room_user_model', 'agent_user_model', 'hi', JSON.stringify({ modelProfileId: 'mp_user_owned', modelSource: 'user_owned' }), now, now)

  const status = billingService.billRun('run_user_model')
  assert.equal(status, 'not_billable')
  const event = db.prepare('SELECT * FROM metered_usage_events WHERE run_id = ?').get('run_user_model') as any
  assert.equal(event.model_source, 'user_owned')
  assert.equal(event.model_provider_user_id, null)
  assert.equal(event.status, 'charged')
  const modelCharges = db.prepare("SELECT COUNT(1) count FROM billing_ledger_entries WHERE run_id = ? AND entry_type = 'model_usage_charge'").get('run_user_model') as any
  assert.equal(modelCharges.count, 0)
  const usageRecords = db.prepare("SELECT COUNT(1) count FROM billing_ledger_entries WHERE run_id = ? AND entry_type = 'usage_record'").get('run_user_model') as any
  assert.equal(usageRecords.count, 1)

  console.log('user owned model billing smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
