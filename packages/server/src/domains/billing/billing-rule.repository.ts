import { v4 as uuidv4 } from 'uuid'
import db from '../../storage/db.js'

export class BillingRuleRepository {
  getModelProfileOwner(profileId: string) {
    return db.prepare('SELECT owner_id FROM model_profiles WHERE id = ?').get(profileId) as any
  }

  listModelRules(profileId: string) {
    return db.prepare('SELECT * FROM model_billing_rules WHERE model_profile_id = ? ORDER BY model').all(profileId) as any[]
  }

  upsertModelRule(profileId: string, model: string, body: any, intValue: (value: any) => number) {
    const existing = db.prepare('SELECT id, created_at FROM model_billing_rules WHERE model_profile_id = ? AND model = ?').get(profileId, model) as any
    const now = Date.now()
    const ruleId = existing?.id || `mbr_${uuidv4()}`
    db.prepare(`
      INSERT OR REPLACE INTO model_billing_rules (
        id, model_profile_id, model, input_credit_per_million, output_credit_per_million,
        cache_write_credit_per_million, cache_read_credit_per_million, min_credits_per_run,
        enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ruleId, profileId, model,
      intValue(body.inputCreditPerMillion ?? body.input_credit_per_million),
      intValue(body.outputCreditPerMillion ?? body.output_credit_per_million),
      intValue(body.cacheWriteCreditPerMillion ?? body.cache_write_credit_per_million),
      intValue(body.cacheReadCreditPerMillion ?? body.cache_read_credit_per_million),
      intValue(body.minCreditsPerRun ?? body.min_credits_per_run),
      body.enabled === false ? 0 : 1,
      existing?.created_at || now,
      now
    )
    return db.prepare('SELECT * FROM model_billing_rules WHERE id = ?').get(ruleId) as any
  }

  ensureDefaultModelRule(profileId: string, model: string, body: any, intValue: (value: any) => number) {
    const existing = db.prepare('SELECT * FROM model_billing_rules WHERE model_profile_id = ? AND model = ?').get(profileId, model) as any
    if (existing) return existing
    return this.upsertModelRule(profileId, model, body, intValue)
  }

  getAgentRule(agentTemplateId: string) {
    return db.prepare('SELECT * FROM agent_billing_rules WHERE agent_template_id = ?').get(agentTemplateId) as any
  }

  upsertAgentRule(agentTemplateId: string, body: any, intValue: (value: any) => number) {
    const existing = db.prepare('SELECT id, created_at FROM agent_billing_rules WHERE agent_template_id = ?').get(agentTemplateId) as any
    const now = Date.now()
    const ruleId = existing?.id || `abr_${uuidv4()}`
    db.prepare(`
      INSERT OR REPLACE INTO agent_billing_rules (
        id, agent_template_id, billing_mode, token_multiplier, fixed_credits_per_run,
        input_credit_per_million, output_credit_per_million, cache_write_credit_per_million,
        cache_read_credit_per_million, revenue_share_rate, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      ruleId, agentTemplateId,
      body.billingMode || body.billing_mode || 'token_multiplier',
      Number(body.tokenMultiplier ?? body.token_multiplier ?? 0),
      intValue(body.fixedCreditsPerRun ?? body.fixed_credits_per_run),
      intValue(body.inputCreditPerMillion ?? body.input_credit_per_million),
      intValue(body.outputCreditPerMillion ?? body.output_credit_per_million),
      intValue(body.cacheWriteCreditPerMillion ?? body.cache_write_credit_per_million),
      intValue(body.cacheReadCreditPerMillion ?? body.cache_read_credit_per_million),
      Number(body.revenueShareRate ?? body.revenue_share_rate ?? 1),
      body.enabled === false ? 0 : 1,
      existing?.created_at || now,
      now
    )
    return db.prepare('SELECT * FROM agent_billing_rules WHERE id = ?').get(ruleId) as any
  }
}

export const billingRuleRepository = new BillingRuleRepository()
