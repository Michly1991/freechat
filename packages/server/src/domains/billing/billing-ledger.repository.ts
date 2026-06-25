import { v4 as uuidv4 } from 'uuid'
import db from '../../storage/db.js'
import type { MeteredUsageEvent } from '../usage-metering/usage.types.js'
import type { BillingLedgerEntry } from './billing.types.js'

function toInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function mapRow(row: any): BillingLedgerEntry {
  const token = row.token_snapshot_json ? JSON.parse(row.token_snapshot_json) : {}
  return {
    id: row.id,
    usageEventId: row.usage_event_id,
    runId: row.run_id,
    accountUserId: row.account_user_id,
    accountRole: row.account_role,
    direction: row.direction,
    entryType: row.entry_type,
    amount: toInt(row.amount),
    currency: row.currency || 'MICRO_CREDIT',
    roomId: row.room_id,
    agentId: row.agent_id,
    agentTemplateId: row.agent_template_id,
    modelProfileId: row.model_profile_id,
    model: row.model,
    inputTokens: toInt(token.inputTokens),
    outputTokens: toInt(token.outputTokens),
    cacheWriteTokens: toInt(token.cacheWriteTokens),
    cacheReadTokens: toInt(token.cacheReadTokens),
    totalTokens: toInt(token.totalTokens),
    tokenSnapshotJson: row.token_snapshot_json,
    ruleSnapshotJson: row.rule_snapshot_json,
    createdAt: toInt(row.created_at),
  }
}

export class BillingLedgerRepository {
  existsForRun(runId: string): boolean {
    return !!db.prepare('SELECT 1 FROM billing_ledger_entries WHERE run_id = ? LIMIT 1').get(runId)
  }

  existsChargeForRun(runId: string): boolean {
    return !!db.prepare("SELECT 1 FROM billing_ledger_entries WHERE run_id = ? AND entry_type != 'usage_record' LIMIT 1").get(runId)
  }

  deleteUsageRecordsForRun(runId: string): void {
    db.prepare("DELETE FROM billing_ledger_entries WHERE run_id = ? AND entry_type = 'usage_record'").run(runId)
  }

  listForRun(runId: string): BillingLedgerEntry[] {
    return (db.prepare('SELECT * FROM billing_ledger_entries WHERE run_id = ? ORDER BY created_at').all(runId) as any[]).map(mapRow)
  }

  createEntry(event: MeteredUsageEvent, input: {
    accountUserId: string
    accountRole: BillingLedgerEntry['accountRole']
    direction: BillingLedgerEntry['direction']
    entryType: BillingLedgerEntry['entryType']
    amount: number
    ruleSnapshot: string
  }): BillingLedgerEntry {
    const id = `ble_${uuidv4()}`
    const tokenSnapshot = JSON.stringify({
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      cacheWriteTokens: event.cacheWriteTokens,
      cacheReadTokens: event.cacheReadTokens,
      totalTokens: event.totalTokens,
    })
    db.prepare(`
      INSERT INTO billing_ledger_entries (
        id, usage_event_id, run_id, account_user_id, account_role, direction, entry_type,
        amount, currency, room_id, agent_id, agent_template_id, model_profile_id, model,
        token_snapshot_json, rule_snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MICRO_CREDIT', ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, event.id, event.runId, input.accountUserId, input.accountRole, input.direction, input.entryType, input.amount, event.roomId, event.agentId, event.agentTemplateId || null, event.modelProfileId || null, event.model || null, tokenSnapshot, input.ruleSnapshot, Date.now())
    return mapRow(db.prepare('SELECT * FROM billing_ledger_entries WHERE id = ?').get(id))
  }
}

export const billingLedgerRepository = new BillingLedgerRepository()
