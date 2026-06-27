import type { TokenUsage } from '../../services/room-analytics.service.js'

export type PricingTarget = 'model_fee' | 'agent_fee' | 'total'
export type PricingOveragePolicy = 'charge' | 'block'

export type DailyFreeRunsPromotion = {
  kind: 'daily_free_runs'
  appliesTo: PricingTarget
  limit: number
  scope: 'payer_agent_day'
  overagePolicy: PricingOveragePolicy
}

export type PricingPromotion = DailyFreeRunsPromotion

export type TokenPricingPolicy = {
  inputCreditPerMillion: number
  outputCreditPerMillion: number
  cacheWriteCreditPerMillion: number
  cacheReadCreditPerMillion: number
  minCreditsPerRun: number
  providerUserId?: string | null
}

export type AgentServicePricingPolicy = TokenPricingPolicy & {
  mode: 'free' | 'per_token'
}

export type AgentPricingPolicy = {
  agentService: AgentServicePricingPolicy
  promotions: PricingPromotion[]
  rawRule?: unknown
}

export type ModelPricingPolicy = TokenPricingPolicy & {
  modelProfileId?: string | null
  model?: string | null
  rawRule?: unknown
}

export type PromotionUsage = {
  promotion: PricingPromotion
  used: number
}

export type PricingEngineInput = {
  usage: TokenUsage
  modelPolicy?: ModelPricingPolicy
  agentPolicy?: AgentPricingPolicy
  chargeAgentService: boolean
  promotionUsage: PromotionUsage[]
}

export type PromotionApplication = {
  kind: PricingPromotion['kind']
  target: PricingTarget
  amountWaived: number
  remainingBefore: number
  remainingAfter: number
}

export type ChargeBreakdown = {
  modelCharge: number
  agentCharge: number
  totalCharge: number
  status: 'billed' | 'price_missing' | 'not_billable'
  promotionsApplied: PromotionApplication[]
  snapshot: string
}
