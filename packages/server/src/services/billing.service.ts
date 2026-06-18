import { billingLedgerRepository } from '../domains/billing/billing-ledger.repository.js'
import type { ChargeResult } from '../domains/billing/billing.types.js'
import type { MeteredUsageEvent } from '../domains/usage-metering/usage.types.js'
import { usageRepository } from '../domains/usage-metering/usage.repository.js'
import db from '../storage/db.js'
import { aiConfigService } from './ai-config.service.js'
import type { TokenUsage } from './room-analytics.service.js'
import { creditWalletService } from './credit-wallet.service.js'

export type BillingStatus = 'not_billable' | 'billed' | 'price_missing' | 'billing_failed'

export type BillingPreflightResult = {
  allowed: boolean
  payerUserId: string
  estimatedMinCredits: number
  balance: number
  reason?: 'INSUFFICIENT_CREDITS'
}

type ModelRule = {
  id: string
  input_credit_per_million?: number | null
  output_credit_per_million?: number | null
  cache_write_credit_per_million?: number | null
  cache_read_credit_per_million?: number | null
  min_credits_per_run?: number | null
}

type AgentRule = {
  id: string
  billing_mode?: string | null
  token_multiplier?: number | null
  fixed_credits_per_run?: number | null
  input_credit_per_million?: number | null
  output_credit_per_million?: number | null
  cache_write_credit_per_million?: number | null
  cache_read_credit_per_million?: number | null
  revenue_share_rate?: number | null
}

function toInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function ceilCredits(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 0
}

function chargeByTokens(usage: TokenUsage, rule: {
  input_credit_per_million?: number | null
  output_credit_per_million?: number | null
  cache_write_credit_per_million?: number | null
  cache_read_credit_per_million?: number | null
}): number {
  const amount =
    (toInt(usage.inputTokens) * Number(rule.input_credit_per_million || 0) / 1_000_000) +
    (toInt(usage.outputTokens) * Number(rule.output_credit_per_million || 0) / 1_000_000) +
    (toInt(usage.cacheCreationInputTokens) * Number(rule.cache_write_credit_per_million || 0) / 1_000_000) +
    (toInt(usage.cacheReadInputTokens) * Number(rule.cache_read_credit_per_million || 0) / 1_000_000)
  return ceilCredits(amount)
}

export class BillingService {
  billRun(runId: string): BillingStatus {
    try {
      const event = usageRepository.createFromRun(runId)
      if (!event) return 'billing_failed'
      if (billingLedgerRepository.existsForRun(runId)) return 'billed'
      if (event.status === 'ignored') return 'not_billable'

      const charge = this.calculateCharge(event)
      const tx = db.transaction(() => {
        if (charge.totalCharge > 0) {
          const entry = billingLedgerRepository.createEntry(event, {
            accountUserId: event.payerUserId,
            accountRole: 'payer',
            direction: 'debit',
            entryType: 'usage_charge',
            amount: charge.totalCharge,
            ruleSnapshot: charge.snapshot,
          })
          creditWalletService.apply(event.payerUserId, -charge.totalCharge, 'usage_charge', { runId, ledgerId: entry.id, note: `Agent run ${runId}` })
        }
        if (charge.modelCharge > 0 && event.modelProviderUserId) {
          const entry = billingLedgerRepository.createEntry(event, {
            accountUserId: event.modelProviderUserId,
            accountRole: 'model_provider',
            direction: 'credit',
            entryType: 'model_income',
            amount: charge.modelCharge,
            ruleSnapshot: charge.snapshot,
          })
          creditWalletService.apply(event.modelProviderUserId, charge.modelCharge, 'model_income', { runId, ledgerId: entry.id, note: `Model usage ${event.model || ''}` })
        }
        if (charge.agentCharge > 0 && event.agentProviderUserId) {
          const entry = billingLedgerRepository.createEntry(event, {
            accountUserId: event.agentProviderUserId,
            accountRole: 'agent_provider',
            direction: 'credit',
            entryType: 'agent_income',
            amount: charge.agentCharge,
            ruleSnapshot: charge.snapshot,
          })
          creditWalletService.apply(event.agentProviderUserId, charge.agentCharge, 'agent_income', { runId, ledgerId: entry.id, note: `Agent template ${event.agentTemplateId || ''}` })
        }
        usageRepository.markStatus(event.id, charge.status === 'billed' ? 'charged' : 'ignored')
      })
      tx()
      return charge.status
    } catch {
      return 'billing_failed'
    }
  }

  checkRoomAgentInvocation(roomId: string, agentId: string): BillingPreflightResult {
    const room = db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(roomId) as any
    const agent = db.prepare('SELECT owner_id, source_template_id FROM agents WHERE id = ?').get(agentId) as any
    const payerUserId = room?.created_by || agent?.owner_id || 'system'
    const binding = this.resolveRoomAgentModelBinding(roomId, agentId)
    const modelRule = binding.modelProfileId && binding.model
      ? this.getModelRule(binding.modelProfileId, binding.model)
      : undefined
    const templateId = agent?.source_template_id || agentId
    const agentRule = templateId && !this.isNativeFreeAssistant(templateId, agentId) ? this.getAgentRule(templateId) : undefined
    const estimatedMinCredits = toInt(modelRule?.min_credits_per_run) + toInt(agentRule?.fixed_credits_per_run)
    const account = creditWalletService.getAccount(payerUserId)
    const allowed = estimatedMinCredits <= 0 || account.balance >= estimatedMinCredits
    return {
      allowed,
      payerUserId,
      estimatedMinCredits,
      balance: account.balance,
      reason: allowed ? undefined : 'INSUFFICIENT_CREDITS',
    }
  }

  private calculateCharge(event: MeteredUsageEvent): ChargeResult {
    const usage: TokenUsage = {
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cacheCreationInputTokens: event.cacheWriteTokens,
      cacheReadInputTokens: event.cacheReadTokens,
    }
    const modelRule = event.modelProfileId && event.model ? this.getModelRule(event.modelProfileId, event.model) : undefined
    const agentRule = event.agentTemplateId && !this.isNativeFreeAssistant(event.agentTemplateId, event.agentId) ? this.getAgentRule(event.agentTemplateId) : undefined
    const modelCharge = modelRule ? Math.max(chargeByTokens(usage, modelRule), toInt(modelRule.min_credits_per_run)) : 0
    const agentCharge = this.calculateAgentCharge(usage, modelCharge, agentRule)
    const totalCharge = modelCharge + agentCharge
    const status: BillingStatus = totalCharge > 0 ? 'billed' : (modelRule || agentRule ? 'not_billable' : 'price_missing')
    return {
      modelCharge,
      agentCharge,
      totalCharge,
      status,
      snapshot: JSON.stringify({ modelRule: modelRule || null, agentRule: agentRule || null }),
    }
  }

  private getModelRule(modelProfileId: string, model: string): ModelRule | undefined {
    return db.prepare(`
      SELECT * FROM model_billing_rules
      WHERE model_profile_id = ? AND model = ? AND enabled = 1
      LIMIT 1
    `).get(modelProfileId, model) as ModelRule | undefined
  }

  private getAgentRule(agentTemplateId: string): AgentRule | undefined {
    return db.prepare(`
      SELECT * FROM agent_billing_rules
      WHERE agent_template_id = ? AND enabled = 1
      LIMIT 1
    `).get(agentTemplateId) as AgentRule | undefined
  }

  private isNativeFreeAssistant(templateId?: string | null, agentId?: string | null): boolean {
    const ids = [templateId, agentId].filter(Boolean)
    for (const id of ids) {
      const row = db.prepare('SELECT role_type, config FROM agents WHERE id = ?').get(id) as any
      if (!row || row.role_type !== 'assistant') continue
      const config = String(row.config || '')
      if (config.includes('"builtInKey":"default_assistant"') || config.includes('"defaultRoomAssistant":true')) return true
    }
    return false
  }

  private calculateAgentCharge(usage: TokenUsage, modelCharge: number, rule?: AgentRule): number {
    if (!rule) return 0
    if (rule.billing_mode === 'free') return 0
    const fixed = toInt(rule.fixed_credits_per_run)
    const tokenCharge = chargeByTokens(usage, rule)
    const multiplierCharge = ceilCredits(modelCharge * Number(rule.token_multiplier || 0))
    return fixed + tokenCharge + multiplierCharge
  }

  private resolveRoomAgentModelBinding(roomId: string, agentId: string): { modelProfileId: string | null; model: string | null } {
    const binding = db.prepare('SELECT model_profile_id, model FROM room_agent_model_bindings WHERE room_id = ? AND agent_id = ?').get(roomId, agentId) as any
    if (binding?.model_profile_id || binding?.model) return { modelProfileId: binding.model_profile_id || null, model: binding.model || null }
    const aiConfig = aiConfigService.getConfig()
    const providerKey = aiConfig.currentProvider
    const provider = providerKey ? aiConfig.providers?.[providerKey] : null
    return { modelProfileId: providerKey ? `mp_platform_${providerKey}` : null, model: provider?.defaultModel || null }
  }
}

export const billingService = new BillingService()
