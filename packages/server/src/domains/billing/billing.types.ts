import type { UsageTokenSnapshot } from '../usage-metering/usage.types.js'

export type BillingLedgerEntry = UsageTokenSnapshot & {
  id: string
  usageEventId: string
  runId: string
  accountUserId: string
  accountRole: 'payer' | 'agent_provider' | 'model_provider' | 'platform'
  direction: 'debit' | 'credit'
  entryType: 'usage_record' | 'usage_charge' | 'model_usage_charge' | 'agent_usage_charge' | 'agent_purchase' | 'agent_income' | 'model_income' | 'refund' | 'adjustment'
  amount: number
  currency: 'CREDIT' | 'MICRO_CREDIT'
  roomId?: string | null
  agentId?: string | null
  agentTemplateId?: string | null
  modelProfileId?: string | null
  model?: string | null
  tokenSnapshotJson?: string | null
  ruleSnapshotJson?: string | null
  createdAt: number
}

export type ChargeResult = {
  modelCharge: number
  agentCharge: number
  totalCharge: number
  status: 'billed' | 'price_missing' | 'not_billable'
  snapshot: string
}
