import db from '../../storage/db.js'
import { PLATFORM_USER_ID } from '../../services/platform-model-bootstrap.service.js'
import type { AgentPricingPolicy, ModelPricingPolicy, PricingPromotion } from './pricing.types.js'

type RuleRow = Record<string, any>

function toInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

function promotionFromAgentRule(rule?: RuleRow): PricingPromotion[] {
  const limit = toInt(rule?.model_free_runs_per_day)
  if (!limit) return []
  return [{
    kind: 'daily_free_runs',
    appliesTo: 'model_fee',
    limit,
    scope: 'payer_agent_day',
    overagePolicy: rule?.model_overage_policy === 'block' ? 'block' : 'charge',
  }]
}

export class PricingPolicyRepository {
  resolveAgentTemplateId(agentId: string): string | null {
    const agent = db.prepare('SELECT source_template_id FROM agents WHERE id = ?').get(agentId) as any
    return agent?.source_template_id || agentId || null
  }

  getAgentPolicy(agentTemplateId: string): AgentPricingPolicy | undefined {
    const rule = db.prepare(`
      SELECT abr.*, a.owner_id provider_user_id
      FROM agent_billing_rules abr
      LEFT JOIN agents a ON a.id = abr.agent_template_id
      WHERE abr.agent_template_id = ? AND abr.enabled = 1
      LIMIT 1
    `).get(agentTemplateId) as RuleRow | undefined
    if (!rule) return undefined
    return {
      agentService: {
        mode: rule.billing_mode === 'per_token' ? 'per_token' : 'free',
        inputCreditPerMillion: toInt(rule.input_credit_per_million),
        outputCreditPerMillion: toInt(rule.output_credit_per_million),
        cacheWriteCreditPerMillion: toInt(rule.cache_write_credit_per_million),
        cacheReadCreditPerMillion: toInt(rule.cache_read_credit_per_million),
        minCreditsPerRun: toInt(rule.min_credits_per_run),
        providerUserId: rule.provider_user_id || null,
      },
      promotions: promotionFromAgentRule(rule),
      rawRule: rule,
    }
  }

  getModelPolicy(modelProfileId: string, model: string): ModelPricingPolicy | undefined {
    const rule = db.prepare(`
      SELECT * FROM model_billing_rules
      WHERE model_profile_id = ? AND model = ? AND enabled = 1
      LIMIT 1
    `).get(modelProfileId, model) as RuleRow | undefined
    return rule ? this.mapModelRule(rule) : undefined
  }

  findPlatformModelPolicy(model: string): ModelPricingPolicy | undefined {
    const rule = db.prepare(`
      SELECT mbr.*
      FROM model_billing_rules mbr
      INNER JOIN model_profiles mp ON mp.id = mbr.model_profile_id
      WHERE mbr.model = ? AND mbr.enabled = 1 AND mp.enabled = 1 AND (mp.visibility = 'platform' OR mp.owner_id = ?)
      ORDER BY CASE WHEN mp.owner_id = ? THEN 0 ELSE 1 END, mbr.updated_at DESC
      LIMIT 1
    `).get(model, PLATFORM_USER_ID, PLATFORM_USER_ID) as RuleRow | undefined
    return rule ? this.mapModelRule(rule) : undefined
  }

  private mapModelRule(rule: RuleRow): ModelPricingPolicy {
    return {
      modelProfileId: rule.model_profile_id || null,
      model: rule.model || null,
      inputCreditPerMillion: toInt(rule.input_credit_per_million),
      outputCreditPerMillion: toInt(rule.output_credit_per_million),
      cacheWriteCreditPerMillion: toInt(rule.cache_write_credit_per_million),
      cacheReadCreditPerMillion: toInt(rule.cache_read_credit_per_million),
      minCreditsPerRun: toInt(rule.min_credits_per_run),
      rawRule: rule,
    }
  }
}

export const pricingPolicyRepository = new PricingPolicyRepository()
