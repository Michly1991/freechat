import type { RoomAgentModelConfig } from '@freechat/shared'
import db from '../storage/db.js'

export type ModelBindingScope = 'agent_default' | 'room_override' | 'platform_default'

export type ModelConfigInput = RoomAgentModelConfig & {
  allowPaidSharedModel?: boolean
}

export type EffectiveAgentModelConfig = RoomAgentModelConfig & {
  scope: ModelBindingScope
  inheritedFromAgent?: boolean
  allowPaidSharedModel?: boolean
}

function sanitizeModelConfig(value: any): ModelConfigInput | null {
  if (!value || typeof value !== 'object') return null
  const out: ModelConfigInput = {}
  if (value.modelProfileId) out.modelProfileId = String(value.modelProfileId)
  if (value.model) out.model = String(value.model)
  if (value.runtime === 'claude-code') out.runtime = value.runtime
  if (value.maxTokens !== undefined) {
    const n = Number(value.maxTokens)
    if (Number.isFinite(n) && n > 0) out.maxTokens = Math.trunc(n)
  }
  if (value.temperature !== undefined) {
    const n = Number(value.temperature)
    if (Number.isFinite(n)) out.temperature = n
  }
  if (value.allowPaidSharedModel !== undefined || value.allow_paid_shared_model !== undefined) {
    out.allowPaidSharedModel = !!(value.allowPaidSharedModel ?? value.allow_paid_shared_model)
  }
  return Object.keys(out).length > 0 ? out : null
}

function canUseProfile(userId: string | undefined | null, profile: any): boolean {
  if (!profile) return false
  if (profile.visibility === 'platform' || profile.visibility === 'shared') return true
  if (userId && profile.owner_id === userId) return true
  if (userId && db.prepare("SELECT 1 FROM market_follows WHERE user_id = ? AND target_type = 'model' AND target_id = ?").get(userId, profile.id)) return true
  return false
}

function getProfile(profileId?: string | null) {
  if (!profileId) return null
  return db.prepare('SELECT id, owner_id, visibility FROM model_profiles WHERE id = ? AND enabled = 1').get(profileId) as any
}

function assertProfileUsableBy(configuredBy: string | undefined | null, modelConfig: ModelConfigInput | null): void {
  if (!modelConfig?.modelProfileId) return
  const profile = getProfile(modelConfig.modelProfileId)
  if (!profile) throw { code: 'MODEL_PROFILE_NOT_FOUND', message: 'Model profile not found or disabled' }
  if (!canUseProfile(configuredBy, profile)) throw { code: 'FORBIDDEN', message: 'No permission to use this model profile' }
}

function assertAgentDefaultShareAllowed(agentId: string, modelConfig: ModelConfigInput | null): void {
  if (!modelConfig?.modelProfileId) return
  const profile = getProfile(modelConfig.modelProfileId)
  if (!profile) throw { code: 'MODEL_PROFILE_NOT_FOUND', message: 'Model profile not found or disabled' }
  const agent = db.prepare('SELECT owner_id FROM agents WHERE id = ?').get(agentId) as any
  if (!agent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
  if (profile.owner_id === agent.owner_id && profile.visibility === 'private' && modelConfig.allowPaidSharedModel) {
    throw { code: 'VALIDATION_ERROR', message: '模型售卖前请先将模型上架为共享模型并配置价格' }
  }
}

function rowToConfig(row: any, scope: ModelBindingScope): EffectiveAgentModelConfig | null {
  if (!row) return null
  return {
    modelProfileId: row.model_profile_id || undefined,
    model: row.model || undefined,
    runtime: row.runtime || undefined,
    maxTokens: row.max_tokens || undefined,
    temperature: row.temperature ?? undefined,
    scope,
    inheritedFromAgent: scope === 'agent_default',
    allowPaidSharedModel: !!row.allow_paid_shared_model,
  }
}

function defaultAgentId(agentId: string): string {
  const row = db.prepare('SELECT COALESCE(source_template_id, id) default_agent_id FROM agents WHERE id = ?').get(agentId) as any
  return row?.default_agent_id || agentId
}

export class AgentModelConfigService {
  sanitize(input: any): ModelConfigInput | null {
    return sanitizeModelConfig(input)
  }

  assertCanUseModelProfile(configuredBy: string | undefined | null, modelConfig: ModelConfigInput | null): void {
    assertProfileUsableBy(configuredBy, modelConfig)
  }

  updateAgentDefault(agentId: string, input: any, configuredBy: string): void {
    const rootAgentId = defaultAgentId(agentId)
    const modelConfig = sanitizeModelConfig(input)
    assertProfileUsableBy(configuredBy, modelConfig)
    assertAgentDefaultShareAllowed(rootAgentId, modelConfig)
    const now = Date.now()
    const tx = db.transaction(() => {
      if (modelConfig) {
        db.prepare(`
          INSERT INTO agent_model_defaults (
            agent_id, model_profile_id, model, runtime, max_tokens, temperature, configured_by, allow_paid_shared_model, extra_config, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(agent_id) DO UPDATE SET
            model_profile_id = excluded.model_profile_id,
            model = excluded.model,
            runtime = excluded.runtime,
            max_tokens = excluded.max_tokens,
            temperature = excluded.temperature,
            configured_by = excluded.configured_by,
            allow_paid_shared_model = excluded.allow_paid_shared_model,
            extra_config = excluded.extra_config,
            updated_at = excluded.updated_at
        `).run(rootAgentId, modelConfig.modelProfileId || null, modelConfig.model || null, modelConfig.runtime || null, modelConfig.maxTokens || null, modelConfig.temperature ?? null, configuredBy, modelConfig.allowPaidSharedModel ? 1 : 0, JSON.stringify({ maxTokens: modelConfig.maxTokens, temperature: modelConfig.temperature }), now)
      } else {
        db.prepare('DELETE FROM agent_model_defaults WHERE agent_id = ?').run(rootAgentId)
      }
    })
    tx()
  }

  updateRoomOverride(roomId: string, agentId: string, input: any, configuredBy?: string): void {
    const modelConfig = sanitizeModelConfig(input)
    assertProfileUsableBy(configuredBy, modelConfig)
    const now = Date.now()
    const tx = db.transaction(() => {
      if (modelConfig) {
        db.prepare(`
          INSERT INTO room_agent_model_bindings (
            room_id, agent_id, model_profile_id, model, runtime, max_tokens, temperature, configured_by, extra_config, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(room_id, agent_id) DO UPDATE SET
            model_profile_id = excluded.model_profile_id,
            model = excluded.model,
            runtime = excluded.runtime,
            max_tokens = excluded.max_tokens,
            temperature = excluded.temperature,
            configured_by = excluded.configured_by,
            extra_config = excluded.extra_config,
            updated_at = excluded.updated_at
        `).run(roomId, agentId, modelConfig.modelProfileId || null, modelConfig.model || null, modelConfig.runtime || null, modelConfig.maxTokens || null, modelConfig.temperature ?? null, configuredBy || null, JSON.stringify({ maxTokens: modelConfig.maxTokens, temperature: modelConfig.temperature }), now)
      } else {
        db.prepare('DELETE FROM room_agent_model_bindings WHERE room_id = ? AND agent_id = ?').run(roomId, agentId)
      }
    })
    tx()
  }

  getEffectiveConfig(roomId: string | null | undefined, agentId: string): EffectiveAgentModelConfig | null {
    if (roomId) {
      const roomRow = db.prepare('SELECT * FROM room_agent_model_bindings WHERE room_id = ? AND agent_id = ?').get(roomId, agentId) as any
      const roomConfig = rowToConfig(roomRow, 'room_override')
      if (roomConfig) return roomConfig
    }
    const defaultRow = db.prepare('SELECT * FROM agent_model_defaults WHERE agent_id = ?').get(defaultAgentId(agentId)) as any
    return rowToConfig(defaultRow, 'agent_default')
  }
}

export const agentModelConfigService = new AgentModelConfigService()
