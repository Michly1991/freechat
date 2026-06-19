import { FastifyInstance } from 'fastify'
import { billingQueryRepository } from '../domains/billing/billing-query.repository.js'
import { billingAggregationService } from '../services/billing-aggregation.service.js'
import { creditWalletService } from '../services/credit-wallet.service.js'
import { creditToMicro, microToCredit } from '../domains/billing/money.js'

function toInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function publicAccount(account: { balance: number; incomeBalance: number }) {
  return { balance: microToCredit(account.balance), incomeBalance: microToCredit(account.incomeBalance) }
}

function billingRole(value: any): 'payer' | 'agent_provider' | 'model_provider' | 'scene_provider' {
  return ['agent_provider', 'model_provider', 'scene_provider'].includes(value) ? value : 'payer'
}

function rangeFromQuery(query: any) {
  return {
    from: query?.from ? Number(query.from) : undefined,
    to: query?.to ? Number(query.to) : undefined,
  }
}

export async function registerBillingRoutes(app: FastifyInstance) {
  app.get('/api/billing/account', async (request, reply) => {
    const user = (request as any).user
    return reply.send({ success: true, data: { account: publicAccount(creditWalletService.getAccount(user.id)) } })
  })

  app.post('/api/billing/adjust', async (request, reply) => {
    const user = (request as any).user
    if (user.role !== 'admin') return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin only' } })
    const body = request.body as any || {}
    const targetUserId = String(body.userId || '')
    const amount = Number(body.amount || 0)
    if (!targetUserId || !Number.isFinite(amount) || amount === 0) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'userId and non-zero amount are required' } })
    const account = creditWalletService.apply(targetUserId, creditToMicro(amount), 'admin_adjust', { note: body.note || 'admin adjustment' })
    return reply.send({ success: true, data: { account: publicAccount(account) } })
  })

  app.post('/api/billing/aggregate', async (request, reply) => {
    const user = (request as any).user
    if (user.role !== 'admin') return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Admin only' } })
    const body = request.body as any || {}
    const count = billingAggregationService.refresh(body.from ? Number(body.from) : undefined, body.to ? Number(body.to) : undefined)
    return reply.send({ success: true, data: { count } })
  })

  app.get('/api/billing/ledger', async (request, reply) => {
    const user = (request as any).user
    const query = request.query as any
    const role = billingRole(query?.role)
    const limit = Math.min(100, Math.max(1, toInt(query?.limit || 50)))
    const items = billingQueryRepository.listLedger(user.id, role, rangeFromQuery(query), limit)
    return reply.send({ success: true, data: { role, items } })
  })

  app.get('/api/billing/summary', async (request, reply) => {
    const user = (request as any).user
    const query = request.query as any
    const role = billingRole(query?.role)
    const range = rangeFromQuery(query)
    const account = publicAccount(creditWalletService.getAccount(user.id))
    const summary = billingQueryRepository.summary(user.id, role, range)
    const byProject = billingQueryRepository.groupedByProject(user.id, role, range)
    const byAgent = billingQueryRepository.groupedByAgent(user.id, role, range)
    const byModel = billingQueryRepository.groupedByModel(user.id, role, range)
    const byScenePurchase = billingQueryRepository.groupedByScenePurchase(user.id, role, range)
    const daily = billingQueryRepository.daily(user.id, role)
    const unbilledUsage = role === 'payer' ? billingQueryRepository.unbilledUsage(user.id, range) : null
    return reply.send({ success: true, data: { role, account, summary, byProject, byAgent, byModel, byScenePurchase, daily, unbilledUsage } })
  })
}
