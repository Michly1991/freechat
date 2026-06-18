import db from '../../storage/db.js'

type BillingRole = 'payer' | 'agent_provider' | 'model_provider'

type Range = { from?: number; to?: number }

function toInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function normalize(row: any) {
  const out = { ...row }
  for (const key of Object.keys(out)) {
    if (/tokens|credits|count|At$/i.test(key) && out[key] !== null && out[key] !== undefined) out[key] = toInt(out[key])
  }
  return out
}

function rangeWhere(alias: string, range: Range) {
  const clauses: string[] = []
  const params: any[] = []
  if (range.from) { clauses.push(`${alias}.created_at >= ?`); params.push(Number(range.from)) }
  if (range.to) { clauses.push(`${alias}.created_at <= ?`); params.push(Number(range.to)) }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params }
}

export class BillingQueryRepository {
  listLedger(userId: string, role: BillingRole, range: Range, limit: number) {
    const src = this.sourceSql(role, range)
    const rows = db.prepare(`
      SELECT x.*, r.name roomName, a.name agentName
      FROM (${src.sql}) x
      LEFT JOIN rooms r ON r.id = x.room_id
      LEFT JOIN agents a ON a.id = x.agent_id
      WHERE x.account_user_id = ?
      ORDER BY x.created_at DESC
      LIMIT ?
    `).all(...src.params, userId, limit) as any[]
    return rows.map(normalize)
  }

  summary(userId: string, role: BillingRole, range: Range) {
    const src = this.sourceSql(role, range)
    const row = db.prepare(`
      SELECT COUNT(*) count,
             COALESCE(SUM(input_tokens), 0) inputTokens,
             COALESCE(SUM(output_tokens), 0) outputTokens,
             COALESCE(SUM(cache_write_tokens), 0) cacheWriteTokens,
             COALESCE(SUM(cache_read_tokens), 0) cacheReadTokens,
             COALESCE(SUM(total_tokens), 0) totalTokens,
             COALESCE(SUM(credit_amount), 0) credits
      FROM (${src.sql}) x
      WHERE x.account_user_id = ?
    `).get(...src.params, userId) as any
    return normalize(row || {})
  }

  groupedByProject(userId: string, role: BillingRole, range: Range) {
    const src = this.sourceSql(role, range)
    const rows = db.prepare(`
      SELECT x.room_id roomId, COALESCE(r.name, x.room_id) roomName, COALESCE(SUM(x.credit_amount), 0) credits, COALESCE(SUM(x.total_tokens), 0) totalTokens, COUNT(*) count
      FROM (${src.sql}) x LEFT JOIN rooms r ON r.id = x.room_id
      WHERE x.account_user_id = ?
      GROUP BY x.room_id
      ORDER BY ABS(credits) DESC
      LIMIT 20
    `).all(...src.params, userId) as any[]
    return rows.map(normalize)
  }

  groupedByAgent(userId: string, role: BillingRole, range: Range) {
    const src = this.sourceSql(role, range)
    const rows = db.prepare(`
      SELECT x.agent_id agentId, COALESCE(a.name, x.agent_id) agentName, COALESCE(SUM(x.credit_amount), 0) credits, COALESCE(SUM(x.total_tokens), 0) totalTokens, COUNT(*) count
      FROM (${src.sql}) x LEFT JOIN agents a ON a.id = x.agent_id
      WHERE x.account_user_id = ?
      GROUP BY x.agent_id
      ORDER BY ABS(credits) DESC
      LIMIT 20
    `).all(...src.params, userId) as any[]
    return rows.map(normalize)
  }

  groupedByModel(userId: string, role: BillingRole, range: Range) {
    const src = this.sourceSql(role, range)
    const rows = db.prepare(`
      SELECT COALESCE(x.model, 'unknown') model, x.model_profile_id modelProfileId, COALESCE(SUM(x.credit_amount), 0) credits, COALESCE(SUM(x.total_tokens), 0) totalTokens, COUNT(*) count
      FROM (${src.sql}) x
      WHERE x.account_user_id = ?
      GROUP BY x.model_profile_id, x.model
      ORDER BY ABS(credits) DESC
      LIMIT 20
    `).all(...src.params, userId) as any[]
    return rows.map(normalize)
  }

  daily(userId: string, role: BillingRole) {
    const rows = db.prepare(`
      SELECT stat_date date, COALESCE(SUM(total_tokens), 0) totalTokens, COALESCE(SUM(credits), 0) credits, COALESCE(SUM(entry_count), 0) count
      FROM billing_daily_stats
      WHERE user_id = ? AND role = ?
      GROUP BY stat_date
      ORDER BY stat_date DESC
      LIMIT 30
    `).all(userId, role) as any[]
    return rows.map(normalize)
  }

  private sourceSql(role: BillingRole, range: Range) {
    const scopedRange = rangeWhere('ble', range)
    const sql = `
      SELECT
        ble.id, ble.run_id, ble.room_id, ble.agent_id, ble.agent_template_id, ble.model_profile_id,
        ble.account_user_id, ble.account_role, ble.entry_type,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.inputTokens'), 0) AS INTEGER) input_tokens,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.outputTokens'), 0) AS INTEGER) output_tokens,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.cacheWriteTokens'), 0) AS INTEGER) cache_write_tokens,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.cacheReadTokens'), 0) AS INTEGER) cache_read_tokens,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.totalTokens'), 0) AS INTEGER) total_tokens,
        ble.model,
        CASE WHEN ble.direction = 'debit' THEN -ble.amount ELSE ble.amount END credit_amount,
        ble.created_at
      FROM billing_ledger_entries ble
      WHERE ble.account_role = '${role}'${scopedRange.sql}
    `
    return { sql, params: scopedRange.params }
  }
}

export const billingQueryRepository = new BillingQueryRepository()
