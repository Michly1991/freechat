import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'

const NATIVE_ASSISTANT_FREE_RULE = {
  billingMode: 'free', tokenMultiplier: 0, fixedCreditsPerRun: 0,
  inputCreditPerMillion: 0, outputCreditPerMillion: 0, cacheWriteCreditPerMillion: 0, cacheReadCreditPerMillion: 0,
}

function agentDefaultRule(row: any) {
  const config = String(row.config || '')
  const nativeAssistant = row.role_type === 'assistant' && (/"builtInKey":"default_assistant"|"defaultRoomAssistant":true/.test(config))
  if (nativeAssistant) return NATIVE_ASSISTANT_FREE_RULE
  if (row.role_type === 'assistant') return { billingMode: 'token_multiplier', tokenMultiplier: 0.1, fixedCreditsPerRun: 2, inputCreditPerMillion: 20, outputCreditPerMillion: 80, cacheWriteCreditPerMillion: 20, cacheReadCreditPerMillion: 5 }
  return { billingMode: 'token_multiplier', tokenMultiplier: 0.2, fixedCreditsPerRun: 5, inputCreditPerMillion: 50, outputCreditPerMillion: 200, cacheWriteCreditPerMillion: 50, cacheReadCreditPerMillion: 10 }
}

function upsertMissingAgentRule(agentId: string, rule: any) {
  const exists = db.prepare('SELECT id FROM agent_billing_rules WHERE agent_template_id = ?').get(agentId)
  if (exists) return
  const now = Date.now()
  db.prepare(`
    INSERT INTO agent_billing_rules (id, agent_template_id, billing_mode, token_multiplier, fixed_credits_per_run, input_credit_per_million, output_credit_per_million, cache_write_credit_per_million, cache_read_credit_per_million, revenue_share_rate, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
  `).run(`abr_${uuidv4()}`, agentId, rule.billingMode, rule.tokenMultiplier, rule.fixedCreditsPerRun, rule.inputCreditPerMillion, rule.outputCreditPerMillion, rule.cacheWriteCreditPerMillion, rule.cacheReadCreditPerMillion, now, now)
}

function upsertMissingSceneRule(scene: any) {
  const exists = db.prepare('SELECT id FROM scene_billing_rules WHERE scene_template_id = ?').get(scene.id)
  if (exists) return
  const builtIn = scene.built_in_key || scene.id === 'scene_agent_management'
  const now = Date.now()
  db.prepare(`
    INSERT INTO scene_billing_rules (id, scene_template_id, billing_mode, fixed_credits_per_purchase, revenue_share_rate, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, 1, ?, ?)
  `).run(`sbr_${uuidv4()}`, scene.id, builtIn ? 'free' : 'fixed', builtIn ? 0 : 20, now, now)
}

export class MarketPricingBootstrapService {
  ensureDefaultMarketPricing(): void {
    const agents = db.prepare(`
      SELECT id, role_type, config FROM agents
      WHERE source_template_id IS NULL OR is_template = 1
    `).all() as any[]
    for (const agent of agents) upsertMissingAgentRule(agent.id, agentDefaultRule(agent))
    const scenes = db.prepare('SELECT id, built_in_key FROM scene_templates').all() as any[]
    for (const scene of scenes) upsertMissingSceneRule(scene)
  }
}

export const marketPricingBootstrapService = new MarketPricingBootstrapService()
