import db from '../../storage/db.js'

export class BillingAggregationRepository {
  clearDailyStats(fromDate: string, toDate: string): void {
    db.prepare('DELETE FROM billing_daily_stats WHERE stat_date BETWEEN ? AND ?').run(fromDate, toDate)
  }

  listLedgerRowsForAggregation(start: number, end: number) {
    return db.prepare(`
      SELECT
        ble.created_at,
        ble.account_user_id user_id,
        ble.account_role role,
        ble.room_id,
        ble.agent_template_id,
        ble.model_profile_id,
        ble.model,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.inputTokens'), 0) AS INTEGER) input_tokens,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.outputTokens'), 0) AS INTEGER) output_tokens,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.cacheWriteTokens'), 0) AS INTEGER) cache_write_tokens,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.cacheReadTokens'), 0) AS INTEGER) cache_read_tokens,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.totalTokens'), 0) AS INTEGER) total_tokens,
        CASE WHEN ble.direction = 'debit' THEN -ble.amount ELSE ble.amount END credit_amount
      FROM billing_ledger_entries ble
      WHERE ble.created_at >= ? AND ble.created_at <= ?
    `).all(start, end) as any[]
  }

  upsertDailyStats(rows: any[], dayOf: (ts: number) => string): void {
    const upsert = db.prepare(`
      INSERT INTO billing_daily_stats (
        stat_date, user_id, role, room_id, agent_template_id, model_profile_id, model,
        input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, total_tokens,
        credits, entry_count, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(stat_date, user_id, role, room_id, agent_template_id, model_profile_id, model)
      DO UPDATE SET
        input_tokens = input_tokens + excluded.input_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
        cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
        total_tokens = total_tokens + excluded.total_tokens,
        credits = credits + excluded.credits,
        entry_count = entry_count + 1,
        updated_at = excluded.updated_at
    `)
    const tx = db.transaction(() => {
      for (const row of rows) {
        if (!row.user_id) continue
        upsert.run(dayOf(row.created_at), row.user_id, row.role, row.room_id || '', row.agent_template_id || '', row.model_profile_id || '', row.model || '', row.input_tokens || 0, row.output_tokens || 0, row.cache_write_tokens || 0, row.cache_read_tokens || 0, row.total_tokens || 0, row.credit_amount || 0, Date.now())
      }
    })
    tx()
  }
}

export const billingAggregationRepository = new BillingAggregationRepository()
