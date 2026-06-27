import type { TokenUsage } from '../../services/room-analytics.service.js'
import { ceilMicro, toInt } from '../billing/money.js'
import type { AgentPricingPolicy, ChargeBreakdown, PricingEngineInput, PricingPromotion, TokenPricingPolicy } from './pricing.types.js'

export function chargeByTokens(usage: TokenUsage, rule: TokenPricingPolicy): number {
  const amount =
    (toInt(usage.inputTokens) * Number(rule.inputCreditPerMillion || 0) / 1_000_000) +
    (toInt(usage.outputTokens) * Number(rule.outputCreditPerMillion || 0) / 1_000_000) +
    (toInt(usage.cacheCreationInputTokens) * Number(rule.cacheWriteCreditPerMillion || 0) / 1_000_000) +
    (toInt(usage.cacheReadInputTokens) * Number(rule.cacheReadCreditPerMillion || 0) / 1_000_000)
  return ceilMicro(amount)
}

function applyPromotion(amount: number, promotion: PricingPromotion, used: number) {
  const remainingBefore = Math.max(0, promotion.limit - used)
  if (promotion.kind !== 'daily_free_runs' || remainingBefore <= 0) return { amount, application: null }
  return {
    amount: 0,
    application: {
      kind: promotion.kind,
      target: promotion.appliesTo,
      amountWaived: amount,
      remainingBefore,
      remainingAfter: Math.max(0, remainingBefore - 1),
    },
  }
}

function promotionsFor(agentPolicy: AgentPricingPolicy | undefined, target: PricingPromotion['appliesTo']) {
  return (agentPolicy?.promotions || []).filter((promotion) => promotion.appliesTo === target || promotion.appliesTo === 'total')
}

export function calculateRunCharge(input: PricingEngineInput): ChargeBreakdown {
  const modelBase = input.modelPolicy ? Math.max(chargeByTokens(input.usage, input.modelPolicy), toInt(input.modelPolicy.minCreditsPerRun)) : 0
  const agentRule = input.agentPolicy?.agentService
  const agentRaw = input.chargeAgentService && agentRule?.mode === 'per_token' ? chargeByTokens(input.usage, agentRule) : 0
  const agentBase = agentRaw > 0 ? Math.max(agentRaw, toInt(agentRule?.minCreditsPerRun)) : 0

  let modelCharge = modelBase
  let agentCharge = agentBase
  const promotionsApplied: ChargeBreakdown['promotionsApplied'] = []

  for (const item of input.promotionUsage) {
    if (item.promotion.appliesTo === 'model_fee' && modelCharge > 0) {
      const result = applyPromotion(modelCharge, item.promotion, item.used)
      modelCharge = result.amount
      if (result.application) promotionsApplied.push(result.application)
    } else if (item.promotion.appliesTo === 'agent_fee' && agentCharge > 0) {
      const result = applyPromotion(agentCharge, item.promotion, item.used)
      agentCharge = result.amount
      if (result.application) promotionsApplied.push(result.application)
    }
  }

  for (const promotion of promotionsFor(input.agentPolicy, 'total')) {
    if (modelCharge + agentCharge <= 0) continue
    const used = input.promotionUsage.find((item) => item.promotion === promotion)?.used || 0
    const result = applyPromotion(modelCharge + agentCharge, promotion, used)
    if (result.application) {
      promotionsApplied.push(result.application)
      modelCharge = 0
      agentCharge = 0
    }
  }

  const totalCharge = modelCharge + agentCharge
  const hasAnyRule = !!input.modelPolicy || !!input.agentPolicy
  const status = totalCharge > 0 ? 'billed' : (hasAnyRule ? 'not_billable' : 'price_missing')
  return {
    modelCharge,
    agentCharge,
    totalCharge,
    status,
    promotionsApplied,
    snapshot: JSON.stringify({ modelPolicy: input.modelPolicy || null, agentPolicy: input.agentPolicy || null, promotionsApplied }),
  }
}
