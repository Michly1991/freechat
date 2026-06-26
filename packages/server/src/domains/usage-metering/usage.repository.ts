import { v4 as uuidv4 } from 'uuid'
import db from '../../storage/db.js'
import { aiConfigService } from '../../services/ai-config.service.js'
import type { MeteredUsageEvent } from './usage.types.js'

function toInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function mapRow(row: any): MeteredUsageEvent {
  return {
    id: row.id,
    runId: row.run_id,
    roomId: row.room_id,
    agentId: row.agent_id,
    agentTemplateId: row.agent_template_id,
    payerUserId: row.payer_user_id,
    agentProviderUserId: row.agent_provider_user_id,
    modelProviderUserId: row.model_provider_user_id,
    modelProfileId: row.model_profile_id,
    runtime: row.runtime,
    model: row.model,
    modelSource: row.model_source,
    baseUrlHost: row.base_url_host,
    inputTokens: toInt(row.input_tokens),
    outputTokens: toInt(row.output_tokens),
    cacheWriteTokens: toInt(row.cache_write_tokens),
    cacheReadTokens: toInt(row.cache_read_tokens),
    totalTokens: toInt(row.total_tokens),
    usageSource: row.usage_source,
    usageTrustLevel: row.usage_trust_level,
    reportedByConnectorId: row.reported_by_connector_id,
    reportedAt: row.reported_at ? toInt(row.reported_at) : null,
    rawUsageJson: row.raw_usage_json,
    status: row.status || 'pending',
    snapshotJson: row.snapshot_json,
    createdAt: toInt(row.created_at),
  }
}

export class UsageRepository {
  findByRunId(runId: string): MeteredUsageEvent | null {
    const row = db.prepare('SELECT * FROM metered_usage_events WHERE run_id = ?').get(runId) as any
    return row ? mapRow(row) : null
  }

  get(id: string): MeteredUsageEvent | null {
    const row = db.prepare('SELECT * FROM metered_usage_events WHERE id = ?').get(id) as any
    return row ? mapRow(row) : null
  }

  createFromRun(runId: string): MeteredUsageEvent | null {
    const existing = this.findByRunId(runId)
    if (existing) return existing
    const run = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as any
    if (!run) return null
    const room = db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(run.room_id) as any
    const agent = db.prepare('SELECT owner_id, source_template_id FROM agents WHERE id = ?').get(run.agent_id) as any
    const templateId = agent?.source_template_id || run.agent_id
    const template = db.prepare('SELECT owner_id FROM agents WHERE id = ?').get(templateId) as any
    const binding = db.prepare(`
      SELECT b.model_profile_id, b.model, mp.owner_id model_provider_user_id, mp.visibility, mp.base_url, mp.default_model
      FROM room_agent_model_bindings b
      LEFT JOIN model_profiles mp ON mp.id = b.model_profile_id AND mp.enabled = 1
      WHERE b.room_id = ? AND b.agent_id = ?
    `).get(run.room_id, run.agent_id) as any
    const aiConfig = aiConfigService.getConfig()
    const currentProviderKey = aiConfig.currentProvider
    const currentProvider = currentProviderKey ? aiConfig.providers?.[currentProviderKey] : null
    const platformProfileId = currentProviderKey ? `mp_platform_${currentProviderKey}` : null
    const platformProfile = platformProfileId && !binding ? db.prepare('SELECT owner_id model_provider_user_id, visibility, base_url, default_model FROM model_profiles WHERE id = ? AND enabled = 1').get(platformProfileId) as any : null
    const clientReported = (run.runtime === 'remote-claude-code' || run.usage_source === 'client_reported') && run.runtime !== 'platform-hosted-client'
    const profileId = clientReported ? null : (binding?.model_profile_id || platformProfileId || null)
    const model = run.model || (clientReported ? null : (binding?.model || binding?.default_model || platformProfile?.default_model || currentProvider?.defaultModel || null))
    const id = `mue_${uuidv4()}`
    const inputTokens = toInt(run.input_tokens)
    const outputTokens = toInt(run.output_tokens)
    const cacheWriteTokens = toInt(run.cache_creation_input_tokens)
    const cacheReadTokens = toInt(run.cache_read_input_tokens)
    const totalTokens = toInt(run.total_tokens)
    const event = {
      id,
      run_id: run.id,
      room_id: run.room_id,
      agent_id: run.agent_id,
      agent_template_id: templateId,
      payer_user_id: run.payer_user_id || room?.created_by || agent?.owner_id || 'system',
      agent_provider_user_id: template?.owner_id || agent?.owner_id || null,
      model_provider_user_id: clientReported ? null : (binding?.model_provider_user_id || platformProfile?.model_provider_user_id || null),
      model_profile_id: profileId,
      runtime: run.runtime,
      model,
      model_source: clientReported ? 'client_reported' : (binding?.visibility || platformProfile?.visibility || (profileId ? 'platform' : 'system_default')),
      base_url_host: clientReported ? null : hostOf(binding?.base_url || platformProfile?.base_url),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_write_tokens: cacheWriteTokens,
      cache_read_tokens: cacheReadTokens,
      total_tokens: totalTokens,
      usage_source: run.usage_source || (run.runtime === 'remote-claude-code' ? 'client_reported' : 'server_metered'),
      usage_trust_level: run.usage_trust_level || (run.runtime === 'remote-claude-code' ? 'provider_reported' : 'trusted'),
      reported_by_connector_id: run.usage_reported_by_connector_id || null,
      reported_at: run.usage_reported_at || null,
      raw_usage_json: run.raw_usage_json || null,
      status: totalTokens === 0 && !model ? 'ignored' : 'pending',
      snapshot_json: JSON.stringify({ runId, source: 'agent_runs', usageSource: run.usage_source || (run.runtime === 'remote-claude-code' ? 'client_reported' : 'server_metered') }),
      created_at: Date.now(),
    }
    db.prepare(`
      INSERT INTO metered_usage_events (
        id, run_id, room_id, agent_id, agent_template_id, payer_user_id, agent_provider_user_id,
        model_provider_user_id, model_profile_id, runtime, model, model_source, base_url_host,
        input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, total_tokens,
        usage_source, usage_trust_level, reported_by_connector_id, reported_at, raw_usage_json,
        status, snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...Object.values(event))
    return this.findByRunId(runId)
  }

  markStatus(id: string, status: MeteredUsageEvent['status']): void {
    db.prepare('UPDATE metered_usage_events SET status = ? WHERE id = ?').run(status, id)
  }
}

function hostOf(url?: string | null): string | null {
  if (!url) return null
  try { return new URL(url).host } catch { return String(url).replace(/^https?:\/\//, '').split('/')[0] || null }
}

export const usageRepository = new UsageRepository()
