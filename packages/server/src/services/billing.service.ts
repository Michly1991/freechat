import { billingLedgerRepository } from '../domains/billing/billing-ledger.repository.js'
import type { ChargeResult } from '../domains/billing/billing.types.js'
import type { MeteredUsageEvent } from '../domains/usage-metering/usage.types.js'
import { usageRepository } from '../domains/usage-metering/usage.repository.js'
import db from '../storage/db.js'
import { aiConfigService } from './ai-config.service.js'
import type { TokenUsage } from './room-analytics.service.js'
import { creditWalletService } from './credit-wallet.service.js'
import { ceilMicro, microToCredit, toInt } from '../domains/billing/money.js'
import { PLATFORM_USER_ID } from './platform-model-bootstrap.service.js'

export type BillingStatus = 'not_billable' | 'billed' | 'price_missing' | 'billing_failed'

export type BillingPreflightResult = {
  allowed: boolean
  payerUserId: string
  estimatedMinCredits: number
  balance: number
  reason?: 'INSUFFICIENT_CREDITS'
}

type TokenRule = {
  id: string
  billing_mode?: string | null
  input_credit_per_million?: number | null
  output_credit_per_million?: number | null
  cache_write_credit_per_million?: number | null
  cache_read_credit_per_million?: number | null
  min_credits_per_run?: number | null
  provider_user_id?: string | null
  model_free_runs_per_day?: number | null
  model_overage_policy?: string | null
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
  return ceilMicro(amount)
}

export class BillingService {
  private dayStart(ts = Date.now()): number {
    const date = new Date(ts)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  private isWithinAgentModelFreeQuota(event: MeteredUsageEvent, agentRule?: TokenRule): boolean {
    const freeRuns = Math.max(0, toInt(agentRule?.model_free_runs_per_day))
    if (!freeRuns || agentRule?.model_overage_policy === 'block') return false
    const used = db.prepare(`
      SELECT COUNT(1) count
      FROM metered_usage_events mue
      LEFT JOIN billing_ledger_entries ble ON ble.usage_event_id = mue.id AND ble.entry_type = 'model_usage_charge' AND ble.direction = 'debit'
      WHERE mue.payer_user_id = ? AND mue.agent_template_id = ? AND mue.created_at >= ?
        AND mue.id != ? AND COALESCE(mue.status, '') IN ('charged', 'ignored')
        AND ble.id IS NULL
    `).get(event.payerUserId, event.agentTemplateId || event.agentId, this.dayStart(event.createdAt), event.id) as any
    return Number(used?.count || 0) < freeRuns
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
    const binding = this.resolveRoomAgentModelBinding(roomId, agentId)
    const modelRule = binding.modelProfileId && binding.model
      ? this.getModelRule(binding.modelProfileId, binding.model)
      : (binding.model ? this.findPlatformModelRule(binding.model) : undefined)
    const agentTemplateId = this.resolveAgentTemplateId(agentId)
    const agentRule = agentTemplateId ? this.getAgentRule(agentTemplateId) : undefined
    const chargeAgent = !!agentRule && agentRule.billing_mode === 'per_token' && agentRule.provider_user_id && agentRule.provider_user_id !== payerUserId
    const estimatedMinMicrocredits = toInt(modelRule?.min_credits_per_run) + (chargeAgent ? toInt(agentRule?.min_credits_per_run) : 0)
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
    const modelRule = this.resolveModelRule(event)
    const agentRule = event.agentTemplateId ? this.getAgentRule(event.agentTemplateId) : undefined
    const modelFreeQuota = this.isWithinAgentModelFreeQuota(event, agentRule)
    const modelCharge = modelFreeQuota ? 0 : (modelRule ? Math.max(chargeByTokens(usage, modelRule), toInt(modelRule.min_credits_per_run)) : 0)
    const chargeAgent = !!agentRule && agentRule.billing_mode === 'per_token' && event.agentProviderUserId && event.agentProviderUserId !== event.payerUserId
    const agentRawCharge = chargeAgent ? chargeByTokens(usage, agentRule) : 0
    const agentCharge = chargeAgent && agentRawCharge > 0 ? Math.max(agentRawCharge, toInt(agentRule.min_credits_per_run)) : 0
    const totalCharge = modelCharge + agentCharge
    const hasAnyRule = !!modelRule || !!agentRule
    const status: BillingStatus = totalCharge > 0 ? 'billed' : (modelRule && modelFreeQuota ? 'not_billable' : (hasAnyRule ? 'not_billable' : 'price_missing'))
    return {
      modelCharge,
      agentCharge,
      totalCharge,
      status,
      snapshot: JSON.stringify({ modelRule: modelRule || null, agentRule: agentRule || null, modelFreeQuotaApplied: !!modelRule && modelFreeQuota }),
    }
  }

  private resolveModelRule(event: MeteredUsageEvent): TokenRule | undefined {
    if (event.usageSource === 'client_reported' || event.modelSource === 'client_reported' || event.runtime === 'remote-claude-code') return undefined
    if (event.modelProfileId && event.model) return this.getModelRule(event.modelProfileId, event.model)
    if (event.model) return this.findPlatformModelRule(event.model)
    return undefined
  }

  private getModelRule(modelProfileId: string, model: string): TokenRule | undefined {
    return db.prepare(`
      SELECT * FROM model_billing_rules
      WHERE model_profile_id = ? AND model = ? AND enabled = 1
      LIMIT 1
    `).get(modelProfileId, model) as TokenRule | undefined
  }

  private findPlatformModelRule(model: string): TokenRule | undefined {
    return db.prepare(`
      SELECT mbr.*
      FROM model_billing_rules mbr
      INNER JOIN model_profiles mp ON mp.id = mbr.model_profile_id
      WHERE mbr.model = ? AND mbr.enabled = 1 AND mp.enabled = 1 AND (mp.visibility = 'platform' OR mp.owner_id = ?)
      ORDER BY CASE WHEN mp.owner_id = ? THEN 0 ELSE 1 END, mbr.updated_at DESC
      LIMIT 1
    `).get(model, PLATFORM_USER_ID, PLATFORM_USER_ID) as TokenRule | undefined
  }

  private getAgentRule(agentTemplateId: string): TokenRule | undefined {
    return db.prepare(`
      SELECT abr.*, a.owner_id provider_user_id
      FROM agent_billing_rules abr
      LEFT JOIN agents a ON a.id = abr.agent_template_id
      WHERE abr.agent_template_id = ? AND abr.enabled = 1
      LIMIT 1
    `).get(agentTemplateId) as TokenRule | undefined
  }

  private resolveAgentTemplateId(agentId: string): string | null {
    const agent = db.prepare('SELECT source_template_id FROM agents WHERE id = ?').get(agentId) as any
    return agent?.source_template_id || agentId || null
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
