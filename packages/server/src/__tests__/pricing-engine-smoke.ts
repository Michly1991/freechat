import assert from 'node:assert/strict'
import { calculateRunCharge } from '../domains/pricing/pricing-engine.js'

const usage = { inputTokens: 1000, outputTokens: 1000, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 }
const modelPolicy = { inputCreditPerMillion: 10000, outputCreditPerMillion: 20000, cacheWriteCreditPerMillion: 0, cacheReadCreditPerMillion: 0, minCreditsPerRun: 0 }
const freeXiaomiPolicy = {
  agentService: { mode: 'free' as const, inputCreditPerMillion: 0, outputCreditPerMillion: 0, cacheWriteCreditPerMillion: 0, cacheReadCreditPerMillion: 0, minCreditsPerRun: 0, providerUserId: 'platform' },
  promotions: [{ kind: 'daily_free_runs' as const, appliesTo: 'model_fee' as const, limit: 20, scope: 'payer_agent_day' as const, overagePolicy: 'charge' as const }],
}

const freeRun = calculateRunCharge({ usage, modelPolicy, agentPolicy: freeXiaomiPolicy, chargeAgentService: false, promotionUsage: [{ promotion: freeXiaomiPolicy.promotions[0], used: 19 }] })
assert.equal(freeRun.modelCharge, 0)
assert.equal(freeRun.agentCharge, 0)
assert.equal(freeRun.status, 'not_billable')
assert.equal(freeRun.promotionsApplied[0]?.remainingAfter, 0)

const chargedRun = calculateRunCharge({ usage, modelPolicy, agentPolicy: freeXiaomiPolicy, chargeAgentService: false, promotionUsage: [{ promotion: freeXiaomiPolicy.promotions[0], used: 20 }] })
assert.equal(chargedRun.modelCharge, 30)
assert.equal(chargedRun.agentCharge, 0)
assert.equal(chargedRun.totalCharge, 30)
assert.equal(chargedRun.status, 'billed')

const agentPolicy = {
  agentService: { mode: 'per_token' as const, inputCreditPerMillion: 5000, outputCreditPerMillion: 10000, cacheWriteCreditPerMillion: 0, cacheReadCreditPerMillion: 0, minCreditsPerRun: 0, providerUserId: 'agent_owner' },
  promotions: [],
}
const agentCharged = calculateRunCharge({ usage, modelPolicy: undefined, agentPolicy, chargeAgentService: true, promotionUsage: [] })
assert.equal(agentCharged.modelCharge, 0)
assert.equal(agentCharged.agentCharge, 15)
assert.equal(agentCharged.status, 'billed')

console.log('pricing engine smoke passed')
