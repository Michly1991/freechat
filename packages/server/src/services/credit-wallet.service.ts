import { walletRepository } from '../domains/wallet/wallet.repository.js'

export class CreditWalletService {
  ensureAccount(userId: string): { balance: number; incomeBalance: number } {
    return walletRepository.ensureAccount(userId)
  }

  apply(userId: string, amount: number, type: string, opts: { runId?: string; ledgerId?: string; note?: string } = {}) {
    const account = this.ensureAccount(userId)
    const isIncome = ['agent_income', 'model_income', 'platform_income'].includes(type)
    const nextBalance = isIncome ? account.balance : account.balance + amount
    const nextIncome = isIncome ? account.incomeBalance + amount : account.incomeBalance
    walletRepository.updateAccount(userId, { balance: nextBalance, incomeBalance: nextIncome })
    walletRepository.insertTransaction({
      userId,
      runId: opts.runId,
      ledgerId: opts.ledgerId,
      type,
      amount,
      balanceAfter: isIncome ? nextIncome : nextBalance,
      note: opts.note || null,
    })
    return { balance: nextBalance, incomeBalance: nextIncome }
  }

  getAccount(userId: string) { return this.ensureAccount(userId) }
}

export const creditWalletService = new CreditWalletService()
