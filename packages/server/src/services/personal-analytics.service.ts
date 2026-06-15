import db from '../storage/db.js'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

type Scope = 'member' | 'owned' | 'triggered'

function toInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function maybeNumber(value: any): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function rangeSql(alias: string, from?: number, to?: number) {
  const clauses: string[] = []
  const params: any[] = []
  if (from) { clauses.push(`${alias}.started_at >= ?`); params.push(from) }
  if (to) { clauses.push(`${alias}.started_at <= ?`); params.push(to) }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params }
}

function runScopeSql(scope: Scope) {
  if (scope === 'owned') return 'ar.room_id IN (SELECT id FROM rooms WHERE created_by = ?)'
  if (scope === 'triggered') return 'ar.actor_user_id = ?'
  return 'ar.room_id IN (SELECT room_id FROM room_members WHERE user_id = ?)'
}

function toolScopeSql(scope: Scope) {
  if (scope === 'triggered') return 'tc.run_id IN (SELECT id FROM agent_runs WHERE actor_user_id = ?)'
  if (scope === 'owned') return 'tc.room_id IN (SELECT id FROM rooms WHERE created_by = ?)'
  return 'tc.room_id IN (SELECT room_id FROM room_members WHERE user_id = ?)'
}

export class PersonalAnalyticsService {
  getOverview(userId: string, query: any = {}) {
    const scope = ['owned', 'triggered'].includes(query.scope) ? query.scope as Scope : 'member'
    const from = maybeNumber(query.from)
    const to = maybeNumber(query.to)
    const runRange = rangeSql('ar', from, to)
    const toolRange = rangeSql('tc', from, to)
    const runWhere = runScopeSql(scope)
    const toolWhere = toolScopeSql(scope)

    const summary = db.prepare(`
      SELECT
        COUNT(DISTINCT ar.room_id) roomCount,
        COUNT(DISTINCT COALESCE(a.source_template_id, ar.agent_id)) agentCount,
        COUNT(DISTINCT ar.agent_id) agentInstanceCount,
        COUNT(*) runCount,
        SUM(CASE WHEN ar.status = 'succeeded' THEN 1 ELSE 0 END) successCount,
        SUM(CASE WHEN ar.status = 'failed' THEN 1 ELSE 0 END) failedCount,
        SUM(CASE WHEN ar.status = 'timeout' THEN 1 ELSE 0 END) timeoutCount,
        COALESCE(SUM(ar.input_tokens), 0) inputTokens,
        COALESCE(SUM(ar.output_tokens), 0) outputTokens,
        COALESCE(SUM(ar.cache_creation_input_tokens), 0) cacheCreationInputTokens,
        COALESCE(SUM(ar.cache_read_input_tokens), 0) cacheReadInputTokens,
        COALESCE(SUM(ar.total_tokens), 0) totalTokens,
        COALESCE(SUM(ar.duration_ms), 0) totalDurationMs,
        COALESCE(AVG(ar.duration_ms), 0) avgDurationMs,
        COALESCE(SUM(ar.tool_call_count), 0) toolCallCount,
        COALESCE(SUM(ar.tool_duration_ms), 0) toolDurationMs,
        CASE WHEN SUM(ar.tool_call_count) > 0 THEN COALESCE(SUM(ar.tool_duration_ms), 0) * 1.0 / SUM(ar.tool_call_count) ELSE 0 END avgToolDurationMs
      FROM agent_runs ar
      LEFT JOIN agents a ON a.id = ar.agent_id
      WHERE ${runWhere}${runRange.sql}
    `).get(userId, ...runRange.params) as any

    const toolFailed = db.prepare(`
      SELECT COUNT(*) toolFailedCount FROM agent_tool_calls tc
      WHERE ${toolWhere} AND tc.status = 'failed'${toolRange.sql}
    `).get(userId, ...toolRange.params) as any

    const agents = db.prepare(`
      SELECT
        COALESCE(a.source_template_id, ar.agent_id) agentKey,
        COALESCE(t.name, a.name, ar.agent_id) agentName,
        COALESCE(t.role_type, a.role_type, '') roleType,
        COUNT(DISTINCT ar.agent_id) agentInstanceCount,
        COUNT(DISTINCT ar.room_id) roomCount,
        COUNT(*) runCount,
        SUM(CASE WHEN ar.status = 'succeeded' THEN 1 ELSE 0 END) successCount,
        SUM(CASE WHEN ar.status = 'failed' THEN 1 ELSE 0 END) failedCount,
        SUM(CASE WHEN ar.status = 'timeout' THEN 1 ELSE 0 END) timeoutCount,
        COALESCE(SUM(ar.input_tokens), 0) inputTokens,
        COALESCE(SUM(ar.output_tokens), 0) outputTokens,
        COALESCE(SUM(ar.cache_creation_input_tokens), 0) cacheCreationInputTokens,
        COALESCE(SUM(ar.cache_read_input_tokens), 0) cacheReadInputTokens,
        COALESCE(SUM(ar.total_tokens), 0) totalTokens,
        COALESCE(SUM(ar.duration_ms), 0) totalDurationMs,
        COALESCE(AVG(ar.duration_ms), 0) avgDurationMs,
        COALESCE(SUM(ar.tool_call_count), 0) toolCallCount,
        COALESCE(SUM(ar.tool_duration_ms), 0) toolDurationMs
      FROM agent_runs ar
      LEFT JOIN agents a ON a.id = ar.agent_id
      LEFT JOIN agents t ON t.id = a.source_template_id
      WHERE ${runWhere}${runRange.sql}
      GROUP BY COALESCE(a.source_template_id, ar.agent_id)
      ORDER BY totalTokens DESC, runCount DESC
    `).all(userId, ...runRange.params).map((x: any) => this.normalize(x))

    const rooms = db.prepare(`
      SELECT ar.room_id roomId, COALESCE(r.name, ar.room_id) roomName,
        COUNT(*) runCount,
        COALESCE(SUM(ar.total_tokens), 0) totalTokens,
        COALESCE(SUM(ar.input_tokens), 0) inputTokens,
        COALESCE(SUM(ar.output_tokens), 0) outputTokens,
        COALESCE(SUM(ar.tool_call_count), 0) toolCallCount,
        COALESCE(SUM((SELECT COUNT(*) FROM agent_tool_calls tc WHERE tc.run_id = ar.id AND tc.status = 'failed')), 0) toolFailedCount
      FROM agent_runs ar
      LEFT JOIN rooms r ON r.id = ar.room_id
      WHERE ${runWhere}${runRange.sql}
      GROUP BY ar.room_id
      ORDER BY totalTokens DESC, runCount DESC
    `).all(userId, ...runRange.params).map((x: any) => this.normalize(x))

    const tools = db.prepare(`
      SELECT tc.tool_name toolName, COUNT(*) callCount,
        SUM(CASE WHEN tc.status = 'failed' THEN 1 ELSE 0 END) failedCount,
        COALESCE(SUM(tc.duration_ms), 0) totalDurationMs,
        COALESCE(AVG(tc.duration_ms), 0) avgDurationMs,
        COALESCE(MAX(tc.duration_ms), 0) maxDurationMs
      FROM agent_tool_calls tc
      WHERE ${toolWhere}${toolRange.sql}
      GROUP BY tc.tool_name
      ORDER BY failedCount DESC, callCount DESC
    `).all(userId, ...toolRange.params).map((x: any) => this.normalize(x))

    const normalizedSummary = this.normalize({ ...(summary || {}), toolFailedCount: toolFailed?.toolFailedCount || 0 })
    return { range: { from, to, scope }, summary: normalizedSummary, agents, rooms, tools }
  }

  getRuns(userId: string, query: any = {}) {
    const scope = ['owned', 'triggered'].includes(query.scope) ? query.scope as Scope : 'member'
    const from = maybeNumber(query.from)
    const to = maybeNumber(query.to)
    const range = rangeSql('ar', from, to)
    const where = runScopeSql(scope)
    const limit = Math.min(MAX_LIMIT, Math.max(1, toInt(query.pageSize || query.limit || DEFAULT_LIMIT)))
    const page = Math.max(1, toInt(query.page || 1))
    const offset = (page - 1) * limit
    const filters: string[] = []
    const extra: any[] = []
    if (query.agentKey) { filters.push('COALESCE(a.source_template_id, ar.agent_id) = ?'); extra.push(String(query.agentKey)) }
    if (query.roomId) { filters.push('ar.room_id = ?'); extra.push(String(query.roomId)) }
    const filterSql = filters.length ? ` AND ${filters.join(' AND ')}` : ''
    const params = [userId, ...range.params, ...extra]

    const items = db.prepare(`
      SELECT ar.id runId, ar.room_id roomId, COALESCE(r.name, ar.room_id) roomName,
        ar.agent_id agentId, COALESCE(t.name, a.name, ar.agent_id) agentName,
        COALESCE(a.source_template_id, ar.agent_id) agentKey,
        ar.status, substr(ar.input, 1, 240) inputPreview, substr(COALESCE(ar.output, ar.error, ''), 1, 240) outputPreview,
        ar.started_at startedAt, ar.finished_at finishedAt, ar.duration_ms durationMs,
        ar.input_tokens inputTokens, ar.output_tokens outputTokens, ar.total_tokens totalTokens,
        ar.tool_call_count toolCallCount, ar.tool_duration_ms toolDurationMs
      FROM agent_runs ar
      LEFT JOIN agents a ON a.id = ar.agent_id
      LEFT JOIN agents t ON t.id = a.source_template_id
      LEFT JOIN rooms r ON r.id = ar.room_id
      WHERE ${where}${range.sql}${filterSql}
      ORDER BY ar.started_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset).map((x: any) => this.normalize(x))
    const total = (db.prepare(`
      SELECT COUNT(*) total FROM agent_runs ar LEFT JOIN agents a ON a.id = ar.agent_id
      WHERE ${where}${range.sql}${filterSql}
    `).get(...params) as any)?.total || 0
    return { items, total: toInt(total), page, pageSize: limit }
  }

  getRunDetail(userId: string, runId: string) {
    const run = db.prepare(`
      SELECT ar.id runId, ar.room_id roomId, COALESCE(r.name, ar.room_id) roomName,
        ar.agent_id agentId, COALESCE(t.name, a.name, ar.agent_id) agentName,
        COALESCE(a.source_template_id, ar.agent_id) agentKey,
        ar.status, ar.input, ar.output, ar.error, ar.started_at startedAt, ar.finished_at finishedAt,
        ar.duration_ms durationMs, ar.input_tokens inputTokens, ar.output_tokens outputTokens,
        ar.cache_creation_input_tokens cacheCreationInputTokens, ar.cache_read_input_tokens cacheReadInputTokens,
        ar.total_tokens totalTokens, ar.tool_call_count toolCallCount, ar.tool_duration_ms toolDurationMs
      FROM agent_runs ar
      LEFT JOIN agents a ON a.id = ar.agent_id
      LEFT JOIN agents t ON t.id = a.source_template_id
      LEFT JOIN rooms r ON r.id = ar.room_id
      WHERE ar.id = ? AND ar.room_id IN (SELECT room_id FROM room_members WHERE user_id = ?)
    `).get(runId, userId) as any
    if (!run) throw { code: 'RUN_NOT_FOUND', message: 'Agent run not found' }
    const toolCalls = db.prepare(`
      SELECT id, tool_name toolName, action, status, error_code errorCode, error_message errorMessage,
        input_summary inputSummary, output_summary outputSummary, started_at startedAt, finished_at finishedAt, duration_ms durationMs
      FROM agent_tool_calls WHERE run_id = ? ORDER BY started_at ASC
    `).all(runId).map((x: any) => this.normalize(x))
    return { run: this.normalize(run), toolCalls }
  }

  private normalize(row: any) {
    const out: any = { ...row }
    for (const key of Object.keys(out)) {
      if (/Count$|Tokens$|Ms$|At$|total$|page$|pageSize$|count$/.test(key) && out[key] !== null && out[key] !== undefined) {
        const n = Number(out[key])
        if (Number.isFinite(n)) out[key] = n
      }
    }
    if (out.callCount !== undefined && out.failedCount !== undefined) out.failureRate = out.callCount ? out.failedCount / out.callCount : 0
    if (out.toolCallCount !== undefined && out.toolFailedCount !== undefined) out.toolFailureRate = out.toolCallCount ? out.toolFailedCount / out.toolCallCount : 0
    if (out.toolCallCount !== undefined && out.toolDurationMs !== undefined) out.avgToolDurationMs = out.toolCallCount ? out.toolDurationMs / out.toolCallCount : 0
    return out
  }
}

export const personalAnalyticsService = new PersonalAnalyticsService()
