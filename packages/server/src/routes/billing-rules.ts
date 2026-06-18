import { FastifyInstance } from 'fastify'
import { agentService } from '../services/agent.service.js'
import { billingRuleRepository } from '../domains/billing/billing-rule.repository.js'

function intValue(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

function rowToModelRule(row: any) {
  return {
    id: row.id,
    modelProfileId: row.model_profile_id,
    model: row.model,
    inputCreditPerMillion: intValue(row.input_credit_per_million),
    outputCreditPerMillion: intValue(row.output_credit_per_million),
    cacheWriteCreditPerMillion: intValue(row.cache_write_credit_per_million),
    cacheReadCreditPerMillion: intValue(row.cache_read_credit_per_million),
    minCreditsPerRun: intValue(row.min_credits_per_run),
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToAgentRule(row: any) {
  return {
    id: row.id,
    agentTemplateId: row.agent_template_id,
    billingMode: row.billing_mode,
    tokenMultiplier: Number(row.token_multiplier || 0),
    fixedCreditsPerRun: intValue(row.fixed_credits_per_run),
    inputCreditPerMillion: intValue(row.input_credit_per_million),
    outputCreditPerMillion: intValue(row.output_credit_per_million),
    cacheWriteCreditPerMillion: intValue(row.cache_write_credit_per_million),
    cacheReadCreditPerMillion: intValue(row.cache_read_credit_per_million),
    revenueShareRate: Number(row.revenue_share_rate ?? 1),
    enabled: !!row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function assertModelProfileOwner(profileId: string, user: any) {
  const row = billingRuleRepository.getModelProfileOwner(profileId)
  if (!row) throw { code: 'MODEL_PROFILE_NOT_FOUND', message: 'Model profile not found' }
  if (row.owner_id !== user.id && user.role !== 'admin') throw { code: 'FORBIDDEN', message: 'Only owner/admin can manage this model profile' }
}

export async function registerBillingRuleRoutes(app: FastifyInstance) {
  app.get('/api/model-profiles/:id/billing-rules', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    try {
      await assertModelProfileOwner(id, user)
      const rules = billingRuleRepository.listModelRules(id).map(rowToModelRule)
      return reply.send({ success: true, data: { rules } })
    } catch (err: any) {
      if (err.code === 'MODEL_PROFILE_NOT_FOUND') return reply.code(404).send({ success: false, error: err })
      if (err.code === 'FORBIDDEN') return reply.code(403).send({ success: false, error: err })
      throw err
    }
  })

  app.put('/api/model-profiles/:id/billing-rules/:model', async (request, reply) => {
    const user = (request as any).user
    const { id, model } = request.params as any
    const body = request.body as any
    if (!String(model || '').trim()) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'model is required' } })
    try {
      await assertModelProfileOwner(id, user)
      const rule = rowToModelRule(billingRuleRepository.upsertModelRule(id, model, body, intValue))
      return reply.send({ success: true, data: { rule } })
    } catch (err: any) {
      if (err.code === 'MODEL_PROFILE_NOT_FOUND') return reply.code(404).send({ success: false, error: err })
      if (err.code === 'FORBIDDEN') return reply.code(403).send({ success: false, error: err })
      throw err
    }
  })

  app.get('/api/agents/:id/billing-rule', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    await agentService.getAgent(id)
    const canEdit = await agentService.canEditAgent(id, user)
    if (!canEdit) return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Only owner/editor can view this Agent billing rule' } })
    const row = billingRuleRepository.getAgentRule(id)
    return reply.send({ success: true, data: { rule: row ? rowToAgentRule(row) : null } })
  })

  app.put('/api/agents/:id/billing-rule', async (request, reply) => {
    const user = (request as any).user
    const { id } = request.params as any
    const body = request.body as any
    await agentService.assertAgentOwner(id, user.id, user.role)
    const rule = rowToAgentRule(billingRuleRepository.upsertAgentRule(id, body, intValue))
    return reply.send({ success: true, data: { rule } })
  })
}
