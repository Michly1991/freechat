import { billingLedgerRepository } from '../domains/billing/billing-ledger.repository.js'
import type { ChargeResult } from '../domains/billing/billing.types.js'
import type { MeteredUsageEvent } from '../domains/usage-metering/usage.types.js'
import { usageRepository } from '../domains/usage-metering/usage.repository.js'
import db from '../storage/db.js'
import { aiConfigService } from './ai-config.service.js'
import { agentModelConfigService } from './agent-model-config.service.js'
import type { TokenUsage } from './room-analytics.service.js'
import { creditWalletService } from './credit-wallet.service.js'
import { microToCredit, toInt } from '../domains/billing/money.js'
import { calculateRunCharge } from '../domains/pricing/pricing-engine.js'
import { pricingPolicyRepository } from '../domains/pricing/pricing-policy.repository.js'
import type { AgentPricingPolicy, PricingPromotion, PromotionUsage } from '../domains/pricing/pricing.types.js'

export type BillingStatus = 'not_billable' | 'billed' | 'price_missing' | 'billing_failed'

export type BillingPreflightResult = {
  allowed: boolean
  payerUserId: string
  estimatedMinCredits: number
  balance: number
  reason?: 'INSUFFICIENT_CREDITS'
}

export class BillingService {
  private dayStart(ts = Date.now()): number {
    const date = new Date(ts)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  private promotionUsed(event: MeteredUsageEvent, promotion: PricingPromotion): number {
    if (promotion.kind !== 'daily_free_runs' || promotion.scope !== 'payer_agent_day') return 0
    return Number((db.prepare(`
      SELECT COUNT(1) count
      FROM metered_usage_events mue
      LEFT JOIN billing_ledger_entries ble ON ble.usage_event_id = mue.id AND ble.entry_type = 'model_usage_charge' AND ble.direction = 'debit'
      WHERE mue.payer_user_id = ? AND mue.agent_template_id = ? AND mue.created_at >= ?
        AND mue.id != ? AND COALESCE(mue.status, '') IN ('charged', 'ignored')
        AND ble.id IS NULL
    `).get(event.payerUserId, event.agentTemplateId || event.agentId, this.dayStart(event.createdAt), event.id) as any)?.count || 0)
  }

  private promotionUsage(event: MeteredUsageEvent, agentPolicy?: AgentPricingPolicy): PromotionUsage[] {
    return (agentPolicy?.promotions || []).map((promotion) => ({ promotion, used: this.promotionUsed(event, promotion) }))
  }

  billRun(runId: string): BillingStatus {
    try {
      const event = usageRepository.createFromRun(runId)
      if (!event) return 'billing_failed'
      if (billingLedgerRepository.existsChargeForRun(runId)) return 'billed'
      billingLedgerRepository.deleteUsageRecordsForRun(runId)
      if (event.status === 'ignored') return 'not_billable'

      const charge = this.calculateCharge(event)
      const tx = db.transaction(() => {
        if (charge.totalCharge === 0 && event.totalTokens > 0) {
          billingLedgerRepository.createEntry(event, {
            accountUserId: event.payerUserId,
            accountRole: 'payer',
            direction: 'debit',
            entryType: 'usage_record',
            amount: 0,
            ruleSnapshot: charge.snapshot,
          })
        }
        if (charge.modelCharge > 0) {
          const entry = billingLedgerRepository.createEntry(event, {
            accountUserId: event.payerUserId,
            accountRole: 'payer',
            direction: 'debit',
            entryType: 'model_usage_charge',
            amount: charge.modelCharge,
            ruleSnapshot: charge.snapshot,
          })
          creditWalletService.apply(event.payerUserId, -charge.modelCharge, 'model_usage_charge', { runId, ledgerId: entry.id, note: `Model usage ${runId}` })
        }
    if (charge.modelCharge > 0 && event.modelProviderUserId && event.modelProviderUserId !== event.payerUserId) {
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
        if (charge.agentCharge > 0) {
          const entry = billingLedgerRepository.createEntry(event, {
            accountUserId: event.payerUserId,
            accountRole: 'payer',
            direction: 'debit',
            entryType: 'agent_usage_charge',
            amount: charge.agentCharge,
            ruleSnapshot: charge.snapshot,
          })
          creditWalletService.apply(event.payerUserId, -charge.agentCharge, 'agent_usage_charge', { runId, ledgerId: entry.id, note: `Agent usage ${runId}` })
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
          creditWalletService.apply(event.agentProviderUserId, charge.agentCharge, 'agent_income', { runId, ledgerId: entry.id, note: `Agent usage ${event.agentTemplateId || event.agentId}` })
        }
        usageRepository.markStatus(event.id, charge.status === 'billed' || event.totalTokens > 0 ? 'charged' : 'ignored')
      })
      tx()
      return charge.status
    } catch (error) {
      console.error('[billing] billRun failed', { runId, error })
      return 'billing_failed'
    }
  }

  checkRoomAgentInvocation(roomId: string, agentId: string, actorUserId?: string): BillingPreflightResult {
    const room = db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(roomId) as any
    const agent = db.prepare('SELECT owner_id FROM agents WHERE id = ?').get(agentId) as any
    const payerUserId = actorUserId || room?.created_by || agent?.owner_id || 'system'
    const binding = this.resolveRoomAgentModelBinding(roomId, agentId, payerUserId)
    const modelPolicy = binding.modelProfileId && binding.model && !binding.isSelfProvidedModel
      ? pricingPolicyRepository.getModelPolicy(binding.modelProfileId, binding.model)
      : (binding.model && !binding.isSelfProvidedModel ? pricingPolicyRepository.findPlatformModelPolicy(binding.model) : undefined)
    const agentTemplateId = pricingPolicyRepository.resolveAgentTemplateId(agentId)
    const agentPolicy = agentTemplateId ? pricingPolicyRepository.getAgentPolicy(agentTemplateId) : undefined
    const chargeAgent = !!agentPolicy?.agentService && agentPolicy.agentService.mode === 'per_token' && agentPolicy.agentService.providerUserId && agentPolicy.agentService.providerUserId !== payerUserId
    const estimatedMinMicrocredits = toInt(modelPolicy?.minCreditsPerRun) + (chargeAgent ? toInt(agentPolicy?.agentService.minCreditsPerRun) : 0)
    const account = creditWalletService.getAccount(payerUserId)
    const allowed = estimatedMinMicrocredits <= 0 || account.balance >= estimatedMinMicrocredits
    return {
      allowed,
      payerUserId,
      estimatedMinCredits: microToCredit(estimatedMinMicrocredits),
      balance: microToCredit(account.balance),
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
    const modelPolicy = this.resolveModelPolicy(event)
    const agentPolicy = event.agentTemplateId ? pricingPolicyRepository.getAgentPolicy(event.agentTemplateId) : undefined
    const chargeAgentService = !!agentPolicy?.agentService.providerUserId && agentPolicy.agentService.providerUserId !== event.payerUserId
    return calculateRunCharge({ usage, modelPolicy, agentPolicy, chargeAgentService, promotionUsage: this.promotionUsage(event, agentPolicy) })
  }

  private resolveModelPolicy(event: MeteredUsageEvent) {
    if (event.modelSource === 'user_owned' || event.isSelfProvidedModel || (event.modelProviderUserId && event.modelProviderUserId === event.payerUserId)) return undefined
    if ((event.usageSource === 'client_reported' || event.modelSource === 'client_reported' || event.runtime === 'remote-claude-code') && event.runtime !== 'platform-hosted-client') return undefined
    if (event.modelProfileId && event.model) return pricingPolicyRepository.getModelPolicy(event.modelProfileId, event.model)
    if (event.model) return pricingPolicyRepository.findPlatformModelPolicy(event.model)
    return undefined
  }

  private resolveRoomAgentModelBinding(roomId: string, agentId: string, payerUserId?: string): { modelProfileId: string | null; model: string | null; isSelfProvidedModel: boolean } {
    const binding = agentModelConfigService.getEffectiveConfig(roomId, agentId)
    if (binding?.modelProfileId || binding?.model) {
      const profile = binding.modelProfileId ? db.prepare('SELECT owner_id FROM model_profiles WHERE id = ? AND enabled = 1').get(binding.modelProfileId) as any : null
      return { modelProfileId: binding.modelProfileId || null, model: binding.model || null, isSelfProvidedModel: !!binding.modelProfileId && !!payerUserId && profile?.owner_id === payerUserId }
    }
    const aiConfig = aiConfigService.getConfig()
    const providerKey = aiConfig.currentProvider
    const provider = providerKey ? aiConfig.providers?.[providerKey] : null
    return { modelProfileId: providerKey ? `mp_platform_${providerKey}` : null, model: provider?.defaultModel || null, isSelfProvidedModel: false }
  }
}

export const billingService = new BillingService()
