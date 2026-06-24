import db from '../../storage/db.js'
import { microToCredit } from './money.js'

type BillingRole = 'payer' | 'agent_provider' | 'model_provider' | 'scene_provider'

type Range = { from?: number; to?: number }

function toInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function normalize(row: any) {
  const out = { ...row }
  for (const key of Object.keys(out)) {
    if ((/tokens$/i.test(key) || key === 'count' || /At$/i.test(key)) && out[key] !== null && out[key] !== undefined) out[key] = toInt(out[key])
    if (/credits|credit_amount/i.test(key) && out[key] !== null && out[key] !== undefined) out[key] = microToCredit(out[key])
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

function purchaseRangeWhere(range: Range, alias = 'ap') {
  const clauses: string[] = []
  const params: any[] = []
  if (range.from) { clauses.push(`${alias}.purchased_at >= ?`); params.push(Number(range.from)) }
  if (range.to) { clauses.push(`${alias}.purchased_at <= ?`); params.push(Number(range.to)) }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params }
}

export class BillingQueryRepository {
  listLedger(userId: string, role: BillingRole, range: Range, limit: number) {
    const src = this.sourceSql(role, range)
    const rows = db.prepare(`
      WITH source AS (${src.sql}),
      runtime AS (
        SELECT
          MIN(id) id,
          run_id,
          MAX(room_id) room_id,
          MAX(agent_id) agent_id,
          MAX(agent_template_id) agent_template_id,
          MAX(model_profile_id) model_profile_id,
          NULL scene_template_id,
          account_user_id,
          account_role,
          CASE WHEN account_role = 'payer' THEN 'run_charge' WHEN account_role = 'agent_provider' THEN 'agent_income' WHEN account_role = 'model_provider' THEN 'model_income' ELSE 'run' END entry_type,
          MAX(input_tokens) input_tokens,
          MAX(output_tokens) output_tokens,
          MAX(cache_write_tokens) cache_write_tokens,
          MAX(cache_read_tokens) cache_read_tokens,
          MAX(total_tokens) total_tokens,
          MAX(model) model,
          SUM(CASE WHEN entry_type IN ('usage_charge', 'model_usage_charge', 'model_income') THEN credit_amount ELSE 0 END) model_credit_amount,
          SUM(CASE WHEN entry_type IN ('agent_usage_charge', 'agent_income') THEN credit_amount ELSE 0 END) agent_credit_amount,
          SUM(credit_amount) credit_amount,
          MAX(created_at) created_at
        FROM source
        WHERE run_id IS NOT NULL AND entry_type IN ('usage_record', 'usage_charge', 'model_usage_charge', 'agent_usage_charge', 'model_income', 'agent_income')
        GROUP BY run_id, account_user_id, account_role
      ),
      standalone AS (
        SELECT
          id, run_id, room_id, agent_id, agent_template_id, model_profile_id, scene_template_id,
          account_user_id, account_role, entry_type,
          input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, total_tokens, model,
          CASE WHEN entry_type IN ('usage_charge', 'model_usage_charge', 'model_income') THEN credit_amount ELSE 0 END model_credit_amount,
          CASE WHEN entry_type IN ('agent_usage_charge', 'agent_income') THEN credit_amount ELSE 0 END agent_credit_amount,
          credit_amount,
          created_at
        FROM source
        WHERE run_id IS NULL OR entry_type NOT IN ('usage_record', 'usage_charge', 'model_usage_charge', 'agent_usage_charge', 'model_income', 'agent_income')
      ),
      rows AS (
        SELECT * FROM runtime
        UNION ALL
        SELECT * FROM standalone
      )
      SELECT rows.*, r.name roomName, COALESCE(t.name, a.name) agentName, st.name sceneName
      FROM rows
      LEFT JOIN rooms r ON r.id = rows.room_id
      LEFT JOIN agents a ON a.id = rows.agent_id
      LEFT JOIN agents t ON t.id = COALESCE(rows.agent_template_id, a.source_template_id, rows.agent_id)
      LEFT JOIN scene_templates st ON st.id = rows.scene_template_id
      WHERE rows.account_user_id = ?
      ORDER BY rows.created_at DESC
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
      SELECT x.room_id roomId, COALESCE(r.name, CASE WHEN x.entry_type = 'scene_purchase' THEN '场景购买' WHEN x.room_id IS NULL THEN '未关联项目' ELSE x.room_id END) roomName, COALESCE(SUM(x.credit_amount), 0) credits, COALESCE(SUM(x.total_tokens), 0) totalTokens, COUNT(*) count
      FROM (${src.sql}) x LEFT JOIN rooms r ON r.id = x.room_id
      WHERE x.account_user_id = ?
      GROUP BY x.room_id, COALESCE(r.name, CASE WHEN x.entry_type = 'scene_purchase' THEN '场景购买' WHEN x.room_id IS NULL THEN '未关联项目' ELSE x.room_id END)
      ORDER BY ABS(credits) DESC
      LIMIT 20
    `).all(...src.params, userId) as any[]
    return rows.map(normalize)
  }

  groupedByAgent(userId: string, role: BillingRole, range: Range) {
    const src = this.sourceSql(role, range)
    const rows = db.prepare(`
      SELECT
        COALESCE(x.agent_template_id, a.source_template_id, x.agent_id) agentId,
        COALESCE(t.name, a.name, COALESCE(x.agent_template_id, a.source_template_id, x.agent_id)) agentName,
        COALESCE(SUM(x.credit_amount), 0) credits,
        COALESCE(SUM(x.total_tokens), 0) totalTokens,
        COUNT(*) count
      FROM (${src.sql}) x
      LEFT JOIN agents a ON a.id = x.agent_id
      LEFT JOIN agents t ON t.id = COALESCE(x.agent_template_id, a.source_template_id, x.agent_id)
      WHERE x.account_user_id = ? AND x.entry_type IN ('agent_usage_charge', 'agent_income')
      GROUP BY COALESCE(x.agent_template_id, a.source_template_id, x.agent_id), COALESCE(t.name, a.name, COALESCE(x.agent_template_id, a.source_template_id, x.agent_id))
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
      WHERE x.account_user_id = ? AND x.entry_type IN ('usage_charge', 'model_usage_charge', 'model_income')
      GROUP BY x.model_profile_id, x.model
      ORDER BY ABS(credits) DESC
      LIMIT 20
    `).all(...src.params, userId) as any[]
    return rows.map(normalize)
  }

  groupedByScenePurchase(userId: string, role: BillingRole, range: Range) {
    const src = this.sourceSql(role, range)
    const rows = db.prepare(`
      SELECT
        x.scene_template_id sceneTemplateId,
        COALESCE(st.name, x.scene_template_id, '未知场景') sceneName,
        COALESCE(SUM(x.credit_amount), 0) credits,
        COUNT(*) count,
        MAX(x.created_at) lastPurchasedAt
      FROM (${src.sql}) x
      LEFT JOIN scene_templates st ON st.id = x.scene_template_id
      WHERE x.account_user_id = ? AND x.entry_type IN ('scene_purchase', 'scene_income')
      GROUP BY x.scene_template_id, COALESCE(st.name, x.scene_template_id, '未知场景')
      ORDER BY ABS(credits) DESC, lastPurchasedAt DESC
      LIMIT 20
    `).all(...src.params, userId) as any[]
    return rows.map(normalize)
  }

  unbilledUsage(userId: string, range: Range) {
    const scopedRange = rangeWhere('mue', range)
    const row = db.prepare(`
      SELECT COUNT(*) count,
             COALESCE(SUM(input_tokens), 0) inputTokens,
             COALESCE(SUM(output_tokens), 0) outputTokens,
             COALESCE(SUM(cache_write_tokens), 0) cacheWriteTokens,
             COALESCE(SUM(cache_read_tokens), 0) cacheReadTokens,
             COALESCE(SUM(total_tokens), 0) totalTokens
      FROM metered_usage_events mue
      WHERE mue.payer_user_id = ? AND mue.status IN ('pending', 'ignored', 'failed')${scopedRange.sql}
        AND NOT EXISTS (SELECT 1 FROM billing_ledger_entries ble WHERE ble.usage_event_id = mue.id)
    `).get(userId, ...scopedRange.params) as any
    return normalize(row || {})
  }

  daily(userId: string, role: BillingRole) {
    const src = this.sourceSql(role, {})
    const rows = db.prepare(`
      SELECT date(x.created_at / 1000, 'unixepoch', 'localtime') date,
             COALESCE(SUM(x.total_tokens), 0) totalTokens,
             COALESCE(SUM(x.credit_amount), 0) credits,
             COUNT(*) count
      FROM (${src.sql}) x
      WHERE x.account_user_id = ?
      GROUP BY date(x.created_at / 1000, 'unixepoch', 'localtime')
      ORDER BY date DESC
      LIMIT 30
    `).all(...src.params, userId) as any[]
    return rows.map(normalize)
  }

  roomSummary(roomId: string, userId: string, fullAccess: boolean, range: Range) {
    const src = this.roomPayerSql(roomId, userId, fullAccess, range)
    const summary = db.prepare(`
      SELECT COUNT(*) count,
             COALESCE(SUM(input_tokens), 0) inputTokens,
             COALESCE(SUM(output_tokens), 0) outputTokens,
             COALESCE(SUM(cache_write_tokens), 0) cacheWriteTokens,
             COALESCE(SUM(cache_read_tokens), 0) cacheReadTokens,
             COALESCE(SUM(total_tokens), 0) totalTokens,
             COALESCE(SUM(credit_amount), 0) credits
      FROM (${src.sql}) x
    `).get(...src.params) as any
    const byAgent = db.prepare(`
      SELECT COALESCE(x.agent_template_id, a.source_template_id, x.agent_id) agentId,
             COALESCE(t.name, a.name, COALESCE(x.agent_template_id, a.source_template_id, x.agent_id), '未知 Agent') agentName,
             COALESCE(SUM(x.credit_amount), 0) credits,
             COALESCE(SUM(x.total_tokens), 0) totalTokens,
             COUNT(*) count
      FROM (${src.sql}) x
      LEFT JOIN agents a ON a.id = x.agent_id
      LEFT JOIN agents t ON t.id = COALESCE(x.agent_template_id, a.source_template_id, x.agent_id)
      GROUP BY COALESCE(x.agent_template_id, a.source_template_id, x.agent_id), COALESCE(t.name, a.name, COALESCE(x.agent_template_id, a.source_template_id, x.agent_id), '未知 Agent')
      ORDER BY ABS(credits) DESC
      LIMIT 20
    `).all(...src.params) as any[]
    const byModel = db.prepare(`
      SELECT COALESCE(x.model, 'unknown') model,
             x.model_profile_id modelProfileId,
             COALESCE(SUM(x.credit_amount), 0) credits,
             COALESCE(SUM(x.total_tokens), 0) totalTokens,
             COUNT(*) count
      FROM (${src.sql}) x
      WHERE x.entry_type IN ('usage_charge', 'model_usage_charge')
      GROUP BY x.model_profile_id, x.model
      ORDER BY ABS(credits) DESC
      LIMIT 20
    `).all(...src.params) as any[]
    const byPayer = db.prepare(`
      SELECT x.account_user_id userId,
             COALESCE(u.nickname, u.username, x.account_user_id) userName,
             COALESCE(SUM(x.credit_amount), 0) credits,
             COALESCE(SUM(x.total_tokens), 0) totalTokens,
             COUNT(*) count
      FROM (${src.sql}) x
      LEFT JOIN users u ON u.id = x.account_user_id
      GROUP BY x.account_user_id, COALESCE(u.nickname, u.username, x.account_user_id)
      ORDER BY ABS(credits) DESC
      LIMIT 20
    `).all(...src.params) as any[]
    const unbilledUsage = this.roomUnbilledUsage(roomId, userId, fullAccess, range)
    return { summary: normalize(summary || {}), byAgent: byAgent.map(normalize), byModel: byModel.map(normalize), byPayer: byPayer.map(normalize), unbilledUsage }
  }

  roomLedger(roomId: string, userId: string, fullAccess: boolean, range: Range, limit: number) {
    const src = this.roomPayerSql(roomId, userId, fullAccess, range)
    const rows = db.prepare(`
      WITH source AS (${src.sql}),
      runtime AS (
        SELECT MIN(id) id, run_id, MAX(room_id) room_id, MAX(agent_id) agent_id,
               MAX(agent_template_id) agent_template_id, MAX(model_profile_id) model_profile_id,
               account_user_id, 'payer' account_role, 'run_charge' entry_type,
               MAX(input_tokens) input_tokens, MAX(output_tokens) output_tokens,
               MAX(cache_write_tokens) cache_write_tokens, MAX(cache_read_tokens) cache_read_tokens,
               MAX(total_tokens) total_tokens, MAX(model) model,
               SUM(CASE WHEN entry_type IN ('usage_charge', 'model_usage_charge') THEN credit_amount ELSE 0 END) model_credit_amount,
               SUM(CASE WHEN entry_type = 'agent_usage_charge' THEN credit_amount ELSE 0 END) agent_credit_amount,
               SUM(credit_amount) credit_amount, MAX(created_at) created_at
        FROM source
        WHERE run_id IS NOT NULL AND entry_type IN ('usage_record', 'usage_charge', 'model_usage_charge', 'agent_usage_charge')
        GROUP BY run_id, account_user_id
      ),
      standalone AS (
        SELECT id, run_id, room_id, agent_id, agent_template_id, model_profile_id,
               account_user_id, account_role, entry_type,
               input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, total_tokens, model,
               CASE WHEN entry_type IN ('usage_charge', 'model_usage_charge') THEN credit_amount ELSE 0 END model_credit_amount,
               CASE WHEN entry_type = 'agent_usage_charge' THEN credit_amount ELSE 0 END agent_credit_amount,
               credit_amount, created_at
        FROM source
        WHERE run_id IS NULL OR entry_type NOT IN ('usage_record', 'usage_charge', 'model_usage_charge', 'agent_usage_charge')
      ),
      rows AS (SELECT * FROM runtime UNION ALL SELECT * FROM standalone)
      SELECT rows.*, COALESCE(u.nickname, u.username, rows.account_user_id) payerName,
             r.name roomName, COALESCE(t.name, a.name) agentName
      FROM rows
      LEFT JOIN users u ON u.id = rows.account_user_id
      LEFT JOIN rooms r ON r.id = rows.room_id
      LEFT JOIN agents a ON a.id = rows.agent_id
      LEFT JOIN agents t ON t.id = COALESCE(rows.agent_template_id, a.source_template_id, rows.agent_id)
      ORDER BY rows.created_at DESC
      LIMIT ?
    `).all(...src.params, limit) as any[]
    return rows.map(normalize)
  }

  private roomUnbilledUsage(roomId: string, userId: string, fullAccess: boolean, range: Range) {
    const scopedRange = rangeWhere('mue', range)
    const payerClause = fullAccess ? '' : ' AND mue.payer_user_id = ?'
    const params = [roomId, ...(fullAccess ? [] : [userId]), ...scopedRange.params]
    const row = db.prepare(`
      SELECT COUNT(*) count,
             COALESCE(SUM(input_tokens), 0) inputTokens,
             COALESCE(SUM(output_tokens), 0) outputTokens,
             COALESCE(SUM(cache_write_tokens), 0) cacheWriteTokens,
             COALESCE(SUM(cache_read_tokens), 0) cacheReadTokens,
             COALESCE(SUM(total_tokens), 0) totalTokens
      FROM metered_usage_events mue
      WHERE mue.room_id = ?${payerClause} AND mue.status IN ('pending', 'ignored', 'failed')${scopedRange.sql}
        AND NOT EXISTS (SELECT 1 FROM billing_ledger_entries ble WHERE ble.usage_event_id = mue.id)
    `).get(...params) as any
    return normalize(row || {})
  }

  private roomPayerSql(roomId: string, userId: string, fullAccess: boolean, range: Range) {
    const ledgerRange = rangeWhere('ble', range)
    const payerClause = fullAccess ? '' : ' AND ble.account_user_id = ?'
    return {
      sql: `
        SELECT ble.id, ble.run_id, ble.room_id, ble.agent_id, ble.agent_template_id, ble.model_profile_id,
               CAST(ble.account_user_id AS TEXT) account_user_id, CAST(ble.account_role AS TEXT) account_role, ble.entry_type,
               CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.inputTokens'), 0) AS INTEGER) input_tokens,
               CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.outputTokens'), 0) AS INTEGER) output_tokens,
               CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.cacheWriteTokens'), 0) AS INTEGER) cache_write_tokens,
               CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.cacheReadTokens'), 0) AS INTEGER) cache_read_tokens,
               CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.totalTokens'), 0) AS INTEGER) total_tokens,
               ble.model,
               CASE WHEN ble.direction = 'debit' THEN -ble.amount ELSE ble.amount END credit_amount,
               ble.created_at
        FROM billing_ledger_entries ble
        WHERE ble.room_id = ? AND ble.account_role = 'payer'${payerClause}${ledgerRange.sql}
      `,
      params: [roomId, ...(fullAccess ? [] : [userId]), ...ledgerRange.params],
    }
  }

  private sourceSql(role: BillingRole, range: Range) {
    const ledgerRange = rangeWhere('ble', range)
    const parts = [`
      SELECT
        ble.id, ble.run_id, ble.room_id, ble.agent_id, ble.agent_template_id, ble.model_profile_id, NULL scene_template_id,
        CAST(ble.account_user_id AS TEXT) account_user_id, CAST(ble.account_role AS TEXT) account_role, ble.entry_type,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.inputTokens'), 0) AS INTEGER) input_tokens,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.outputTokens'), 0) AS INTEGER) output_tokens,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.cacheWriteTokens'), 0) AS INTEGER) cache_write_tokens,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.cacheReadTokens'), 0) AS INTEGER) cache_read_tokens,
        CAST(COALESCE(json_extract(ble.token_snapshot_json, '$.totalTokens'), 0) AS INTEGER) total_tokens,
        ble.model,
        CASE WHEN ble.direction = 'debit' THEN -ble.amount ELSE ble.amount END credit_amount,
        ble.created_at
      FROM billing_ledger_entries ble
      WHERE ble.account_role = '${role}'${ledgerRange.sql}
    `]
    const params = [...ledgerRange.params]

    if (role === 'payer' || role === 'agent_provider') {
      const purchaseRange = purchaseRangeWhere(range)
      params.push(...purchaseRange.params)
      parts.push(role === 'payer' ? `
        SELECT
          ap.id || ':payer' id, NULL run_id, ap.room_id, NULL agent_id, ap.agent_template_id, NULL model_profile_id, NULL scene_template_id,
          CAST(ap.buyer_user_id AS TEXT) account_user_id, CAST('payer' AS TEXT) account_role, 'agent_purchase' entry_type,
          0 input_tokens, 0 output_tokens, 0 cache_write_tokens, 0 cache_read_tokens, 0 total_tokens,
          NULL model,
          -ap.price_microcredits credit_amount,
          ap.purchased_at created_at
        FROM agent_purchases ap
        WHERE ap.status = 'completed' AND ap.price_microcredits > 0${purchaseRange.sql}
      ` : `
        SELECT
          ap.id || ':agent_provider' id, NULL run_id, ap.room_id, NULL agent_id, ap.agent_template_id, NULL model_profile_id, NULL scene_template_id,
          CAST(a.owner_id AS TEXT) account_user_id, CAST('agent_provider' AS TEXT) account_role, 'agent_income' entry_type,
          0 input_tokens, 0 output_tokens, 0 cache_write_tokens, 0 cache_read_tokens, 0 total_tokens,
          NULL model,
          ap.price_microcredits credit_amount,
          ap.purchased_at created_at
        FROM agent_purchases ap
        INNER JOIN agents a ON a.id = ap.agent_template_id
        WHERE ap.status = 'completed' AND ap.price_microcredits > 0${purchaseRange.sql}
      `)
    }

    if (role === 'payer' || role === 'scene_provider') {
      const sceneRange = purchaseRangeWhere(range, 'sp')
      params.push(...sceneRange.params)
      parts.push(role === 'payer' ? `
        SELECT
          sp.id || ':payer' id, NULL run_id, NULL room_id, NULL agent_id, NULL agent_template_id, NULL model_profile_id, sp.scene_template_id scene_template_id,
          CAST(sp.user_id AS TEXT) account_user_id, CAST('payer' AS TEXT) account_role, 'scene_purchase' entry_type,
          0 input_tokens, 0 output_tokens, 0 cache_write_tokens, 0 cache_read_tokens, 0 total_tokens,
          NULL model,
          -sp.price_microcredits credit_amount,
          sp.purchased_at created_at
        FROM scene_purchases sp
        WHERE sp.status = 'completed' AND sp.price_microcredits > 0${sceneRange.sql}
      ` : `
        SELECT
          sp.id || ':scene_provider' id, NULL run_id, NULL room_id, NULL agent_id, NULL agent_template_id, NULL model_profile_id, sp.scene_template_id scene_template_id,
          CAST(st.owner_id AS TEXT) account_user_id, CAST('scene_provider' AS TEXT) account_role, 'scene_income' entry_type,
          0 input_tokens, 0 output_tokens, 0 cache_write_tokens, 0 cache_read_tokens, 0 total_tokens,
          NULL model,
          sp.price_microcredits credit_amount,
          sp.purchased_at created_at
        FROM scene_purchases sp
        INNER JOIN scene_templates st ON st.id = sp.scene_template_id
        WHERE sp.status = 'completed' AND sp.price_microcredits > 0${sceneRange.sql}
      `)
    }

    if (role === 'payer') {
      const txRange = rangeWhere('ct', range)
      params.push(...txRange.params)
      parts.push(`
        SELECT
          ct.id || ':wallet' id, ct.run_id, NULL room_id, NULL agent_id, NULL agent_template_id, NULL model_profile_id, NULL scene_template_id,
          CAST(ct.user_id AS TEXT) account_user_id, CAST('payer' AS TEXT) account_role, ct.type entry_type,
          0 input_tokens, 0 output_tokens, 0 cache_write_tokens, 0 cache_read_tokens, 0 total_tokens,
          CASE WHEN ct.type = 'usage_charge' THEN '历史扣费（原运行已删除）' ELSE NULL END model,
          ct.amount credit_amount,
          ct.created_at
        FROM credit_transactions ct
        WHERE ct.type IN ('usage_charge', 'model_usage_charge', 'agent_usage_charge', 'scene_purchase', 'agent_purchase')${txRange.sql}
          AND NOT EXISTS (SELECT 1 FROM billing_ledger_entries ble WHERE ble.account_user_id = ct.user_id AND ble.run_id = ct.run_id AND ct.run_id IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM scene_purchases sp WHERE sp.user_id = ct.user_id AND sp.price_microcredits = -ct.amount AND ABS(sp.purchased_at - ct.created_at) < 10000)
          AND NOT EXISTS (SELECT 1 FROM agent_purchases ap WHERE ap.buyer_user_id = ct.user_id AND ap.price_microcredits = -ct.amount AND ABS(ap.purchased_at - ct.created_at) < 10000)
      `)
    }

    return { sql: parts.join('\nUNION ALL\n'), params }
  }
}

export const billingQueryRepository = new BillingQueryRepository()
