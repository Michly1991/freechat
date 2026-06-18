import { billingAggregationRepository } from '../domains/billing/billing-aggregation.repository.js'

function dayOf(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

export class BillingAggregationService {
  refresh(from?: number, to?: number): number {
    const start = from || 0
    const end = to || Date.now()
    billingAggregationRepository.clearDailyStats(dayOf(start), dayOf(end))
    const rows = billingAggregationRepository.listLedgerRowsForAggregation(start, end)
    billingAggregationRepository.upsertDailyStats(rows, dayOf)
    return rows.length
  }
}

export const billingAggregationService = new BillingAggregationService()
