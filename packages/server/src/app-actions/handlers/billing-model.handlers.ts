import { billingQueryRepository } from '../../domains/billing/billing-query.repository.js'
import { microToCredit } from '../../domains/billing/money.js'
import { creditWalletService } from '../../services/credit-wallet.service.js'
import { modelProfileService } from '../../services/model-profile.service.js'
import type { ToolExecutionContext, ToolHandlerOutcome } from '../types.js'

function toInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function billingRole(value: any): 'payer' | 'agent_provider' | 'model_provider' | 'scene_provider' {
  return ['agent_provider', 'model_provider', 'scene_provider'].includes(value) ? value : 'payer'
}

function rangeFromArgs(args: any) {
  const now = Date.now()
  if (args?.range === 'today') {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    return { from: d.getTime(), to: now }
  }
  if (args?.range === 'this_month') {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0)
    return { from: d.getTime(), to: now }
  }
  return { from: args?.from ? Number(args.from) : undefined, to: args?.to ? Number(args.to) : undefined }
}

function publicAccount(account: { balance: number; incomeBalance: number }) {
  return { balance: microToCredit(account.balance), incomeBalance: microToCredit(account.incomeBalance) }
}

export async function handleBillingModelAction(ctx: ToolExecutionContext, args: any = {}): Promise<ToolHandlerOutcome> {
  switch (ctx.action) {
    case 'billing.account':
      return { handled: true, response: { success: true, data: { account: publicAccount(creditWalletService.getAccount(ctx.actorUserId)) } } }
    case 'billing.ledger': {
      const role = billingRole(args.role)
      const limit = Math.min(100, Math.max(1, toInt(args.limit || 50)))
      return { handled: true, response: { success: true, data: { role, items: billingQueryRepository.listLedger(ctx.actorUserId, role, rangeFromArgs(args), limit) } } }
    }
    case 'billing.summary': {
      const role = billingRole(args.role), range = rangeFromArgs(args)
      return { handled: true, response: { success: true, data: { role, account: publicAccount(creditWalletService.getAccount(ctx.actorUserId)), summary: billingQueryRepository.summary(ctx.actorUserId, role, range), byProject: billingQueryRepository.groupedByProject(ctx.actorUserId, role, range), byAgent: billingQueryRepository.groupedByAgent(ctx.actorUserId, role, range), byModel: billingQueryRepository.groupedByModel(ctx.actorUserId, role, range), byScenePurchase: billingQueryRepository.groupedByScenePurchase(ctx.actorUserId, role, range), daily: billingQueryRepository.daily(ctx.actorUserId, role), unbilledUsage: role === 'payer' ? billingQueryRepository.unbilledUsage(ctx.actorUserId, range) : null } } }
    }
    case 'model.profile.list':
      return { handled: true, response: { success: true, data: { profiles: modelProfileService.listVisible(ctx.actorUserId, ctx.actorRole) } } }
    default:
      return { handled: false }
  }
}
