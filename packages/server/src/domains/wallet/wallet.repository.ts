import { v4 as uuidv4 } from 'uuid'
import db from '../../storage/db.js'

function toInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

export type WalletAccount = { balance: number; incomeBalance: number }

export class WalletRepository {
  ensureAccount(userId: string): WalletAccount {
    const now = Date.now()
    db.prepare('INSERT OR IGNORE INTO credit_accounts (user_id, balance, income_balance, updated_at) VALUES (?, 0, 0, ?)').run(userId, now)
    const row = db.prepare('SELECT balance, income_balance FROM credit_accounts WHERE user_id = ?').get(userId) as any
    return { balance: toInt(row?.balance), incomeBalance: toInt(row?.income_balance) }
  }

  updateAccount(userId: string, account: WalletAccount): void {
    db.prepare('UPDATE credit_accounts SET balance = ?, income_balance = ?, updated_at = ? WHERE user_id = ?').run(account.balance, account.incomeBalance, Date.now(), userId)
  }

  insertTransaction(input: { userId: string; runId?: string; ledgerId?: string; type: string; amount: number; balanceAfter: number; note?: string | null }): void {
    db.prepare(`
      INSERT INTO credit_transactions (id, user_id, run_id, ledger_id, type, amount, balance_after, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`ctx_${uuidv4()}`, input.userId, input.runId || null, input.ledgerId || null, input.type, input.amount, input.balanceAfter, input.note || null, Date.now())
  }
}

export const walletRepository = new WalletRepository()
