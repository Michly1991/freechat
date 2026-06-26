import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { nonNegativeCreditToMicro } from '../domains/billing/money.js'

const NATIVE_ASSISTANT_FREE_RULE = { billingMode: 'free', input: 0, output: 0, cacheWrite: 0, cacheRead: 0, modelFreeRunsPerDay: 0 }

function agentDefaultRule(_row: any) {
  return NATIVE_ASSISTANT_FREE_RULE
}

function upsertMissingAgentRule(agentId: string, rule: any) {
  const exists = db.prepare('SELECT id FROM agent_billing_rules WHERE agent_template_id = ?').get(agentId)
  if (exists) return
  const now = Date.now()
  db.prepare(`
    INSERT INTO agent_billing_rules (id, agent_template_id, billing_mode, token_multiplier, fixed_credits_per_run, fixed_credits_per_purchase, input_credit_per_million, output_credit_per_million, cache_write_credit_per_million, cache_read_credit_per_million, min_credits_per_run, model_free_runs_per_day, model_overage_policy, revenue_share_rate, enabled, created_at, updated_at)
    VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?, ?, 0, ?, 'charge', 1, 1, ?, ?)
  `).run(`abr_${uuidv4()}`, agentId, rule.billingMode, nonNegativeCreditToMicro(rule.input), nonNegativeCreditToMicro(rule.output), nonNegativeCreditToMicro(rule.cacheWrite), nonNegativeCreditToMicro(rule.cacheRead), Math.max(0, Math.trunc(Number(rule.modelFreeRunsPerDay || 0))), now, now)
}

function upsertMissingSceneRule(scene: any) {
  const exists = db.prepare('SELECT id FROM scene_billing_rules WHERE scene_template_id = ?').get(scene.id)
  if (exists) return
  const builtIn = scene.built_in_key || scene.id === 'scene_agent_management'
  const now = Date.now()
  db.prepare(`
    INSERT INTO scene_billing_rules (id, scene_template_id, billing_mode, fixed_credits_per_purchase, revenue_share_rate, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, 1, ?, ?)
  `).run(`sbr_${uuidv4()}`, scene.id, builtIn ? 'free' : 'fixed', nonNegativeCreditToMicro(builtIn ? 0 : 20), now, now)
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
