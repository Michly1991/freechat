import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'

export type TokenUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheCreationInputTokens?: number
  cacheReadInputTokens?: number
}

type ToolCallStart = {
  roomId: string
  agentId: string
  runId?: string | null
  streamId?: string | null
  toolName: string
  action?: string | null
  inputSummary?: string | null
}

type ToolCallFinish = {
  status: 'succeeded' | 'failed'
  outputSummary?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

function toInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function maybeNumber(value: any): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function compactJson(value: any, max = 800): string | null {
  if (value === undefined || value === null) return null
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text.length > max ? `${text.slice(0, max)}…` : text
  } catch {
    const text = String(value)
    return text.length > max ? `${text.slice(0, max)}…` : text
  }
}

function whereRange(alias: string, from?: number, to?: number): { sql: string; params: any[] } {
  const params: any[] = []
  const clauses: string[] = []
  if (from) { clauses.push(`${alias}.started_at >= ?`); params.push(from) }
  if (to) { clauses.push(`${alias}.started_at <= ?`); params.push(to) }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params }
}

export class RoomAnalyticsService {
  extractUsage(item: any): TokenUsage | null {
    const candidates = [
      item?.message?.usage,
      item?.usage,
      item?.result?.usage,
      item?.result?.message?.usage,
      item?.response?.usage,
    ]
    for (const usage of candidates) {
      if (!usage || typeof usage !== 'object') continue
      const parsed = {
        inputTokens: maybeNumber(usage.input_tokens ?? usage.prompt_tokens),
        outputTokens: maybeNumber(usage.output_tokens ?? usage.completion_tokens),
        cacheCreationInputTokens: maybeNumber(usage.cache_creation_input_tokens),
        cacheReadInputTokens: maybeNumber(usage.cache_read_input_tokens),
      }
      if (Object.values(parsed).some((v) => v !== undefined)) return parsed
    }
    return null
  }

  addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
    return {
      inputTokens: toInt(a.inputTokens) + toInt(b.inputTokens),
      outputTokens: toInt(a.outputTokens) + toInt(b.outputTokens),
      cacheCreationInputTokens: toInt(a.cacheCreationInputTokens) + toInt(b.cacheCreationInputTokens),
      cacheReadInputTokens: toInt(a.cacheReadInputTokens) + toInt(b.cacheReadInputTokens),
    }
  }

  totalTokens(usage: TokenUsage): number {
    return toInt(usage.inputTokens) + toInt(usage.outputTokens) + toInt(usage.cacheCreationInputTokens) + toInt(usage.cacheReadInputTokens)
  }

  createToolCall(input: ToolCallStart): string {
    const id = `atool_${uuidv4()}`
    db.prepare(`
      INSERT INTO agent_tool_calls (id, room_id, agent_id, run_id, stream_id, tool_name, action, status, input_summary, started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
    `).run(id, input.roomId, input.agentId, input.runId || null, input.streamId || null, input.toolName, input.action || input.toolName, input.inputSummary || null, Date.now())
    return id
  }

  finishToolCall(id: string, finish: ToolCallFinish): void {
    const now = Date.now()
    const row = db.prepare('SELECT run_id, started_at FROM agent_tool_calls WHERE id = ?').get(id) as any
    if (!row) return
    const duration = Math.max(0, now - Number(row.started_at || now))
    db.prepare(`
      UPDATE agent_tool_calls
      SET status = ?, output_summary = ?, error_code = ?, error_message = ?, finished_at = ?, duration_ms = ?
      WHERE id = ?
    `).run(finish.status, finish.outputSummary || null, finish.errorCode || null, finish.errorMessage || null, now, duration, id)
    if (row.run_id) {
      db.prepare(`
        UPDATE agent_runs
        SET tool_call_count = COALESCE(tool_call_count, 0) + 1,
            tool_duration_ms = COALESCE(tool_duration_ms, 0) + ?
        WHERE id = ?
      `).run(duration, row.run_id)
    }
  }

  findActiveRun(roomId: string, agentId: string): string | null {
    const row = db.prepare(`
      SELECT id FROM agent_runs
      WHERE room_id = ? AND agent_id = ? AND status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
    `).get(roomId, agentId) as any
    return row?.id || null
  }

  summarizeInput(value: any): string | null { return compactJson(value, 800) }
  summarizeOutput(value: any): string | null { return compactJson(value, 800) }

  errorCode(err: any, fallbackStatus?: number): string {
    return String(err?.code || err?.error?.code || err?.response?.error?.code || (fallbackStatus ? `HTTP_${fallbackStatus}` : 'UNKNOWN_ERROR'))
  }

  errorMessage(err: any): string {
    return String(err?.message || err?.error?.message || err?.response?.error?.message || err || 'Unknown error').slice(0, 1000)
  }

  getOverview(roomId: string, query: any = {}) {
    const from = maybeNumber(query.from)
    const to = maybeNumber(query.to)
    const range = whereRange('ar', from, to)
    const toolRange = whereRange('tc', from, to)

    const summary = db.prepare(`
      SELECT
        COUNT(*) runCount,
        SUM(CASE WHEN ar.status = 'succeeded' THEN 1 ELSE 0 END) successCount,
        SUM(CASE WHEN ar.status = 'failed' THEN 1 ELSE 0 END) failedCount,
        SUM(CASE WHEN ar.status = 'timeout' THEN 1 ELSE 0 END) timeoutCount,
        COALESCE(SUM(ar.duration_ms), 0) totalDurationMs,
        COALESCE(AVG(ar.duration_ms), 0) avgDurationMs,
        COALESCE(SUM(ar.input_tokens), 0) inputTokens,
        COALESCE(SUM(ar.output_tokens), 0) outputTokens,
        COALESCE(SUM(ar.cache_creation_input_tokens), 0) cacheCreationInputTokens,
        COALESCE(SUM(ar.cache_read_input_tokens), 0) cacheReadInputTokens,
        COALESCE(SUM(ar.total_tokens), 0) totalTokens,
        COALESCE(SUM(ar.tool_call_count), 0) toolCallCount,
        COALESCE(SUM(ar.tool_duration_ms), 0) toolDurationMs,
        CASE WHEN SUM(ar.tool_call_count) > 0 THEN COALESCE(SUM(ar.tool_duration_ms), 0) * 1.0 / SUM(ar.tool_call_count) ELSE 0 END avgToolDurationMs
      FROM agent_runs ar
      WHERE ar.room_id = ?${range.sql}
    `).get(roomId, ...range.params) as any

    const agents = db.prepare(`
      SELECT
        ar.agent_id agentId,
        COALESCE(a.name, ar.agent_id) agentName,
        COALESCE(a.role_type, '') roleType,
        COUNT(*) runCount,
        SUM(CASE WHEN ar.status = 'succeeded' THEN 1 ELSE 0 END) successCount,
        SUM(CASE WHEN ar.status = 'failed' THEN 1 ELSE 0 END) failedCount,
        SUM(CASE WHEN ar.status = 'timeout' THEN 1 ELSE 0 END) timeoutCount,
        COALESCE(SUM(ar.duration_ms), 0) totalDurationMs,
        COALESCE(AVG(ar.duration_ms), 0) avgDurationMs,
        COALESCE(SUM(ar.input_tokens), 0) inputTokens,
        COALESCE(SUM(ar.output_tokens), 0) outputTokens,
        COALESCE(SUM(ar.cache_creation_input_tokens), 0) cacheCreationInputTokens,
        COALESCE(SUM(ar.cache_read_input_tokens), 0) cacheReadInputTokens,
        COALESCE(SUM(ar.total_tokens), 0) totalTokens,
        COALESCE(SUM(ar.tool_call_count), 0) toolCallCount,
        COALESCE(SUM(ar.tool_duration_ms), 0) toolDurationMs,
        CASE WHEN SUM(ar.tool_call_count) > 0 THEN COALESCE(SUM(ar.tool_duration_ms), 0) * 1.0 / SUM(ar.tool_call_count) ELSE 0 END avgToolDurationMs
      FROM agent_runs ar
      LEFT JOIN agents a ON a.id = ar.agent_id
      WHERE ar.room_id = ?${range.sql}
      GROUP BY ar.agent_id
      ORDER BY totalTokens DESC, runCount DESC
    `).all(roomId, ...range.params)

    const tools = db.prepare(`
      SELECT
        tc.tool_name toolName,
        COUNT(*) callCount,
        SUM(CASE WHEN tc.status = 'succeeded' THEN 1 ELSE 0 END) successCount,
        SUM(CASE WHEN tc.status = 'failed' THEN 1 ELSE 0 END) failedCount,
        COALESCE(SUM(tc.duration_ms), 0) totalDurationMs,
        COALESCE(AVG(tc.duration_ms), 0) avgDurationMs,
        COALESCE(MAX(tc.duration_ms), 0) maxDurationMs,
        MAX(CASE WHEN tc.status = 'failed' THEN tc.finished_at ELSE NULL END) lastFailedAt
      FROM agent_tool_calls tc
      WHERE tc.room_id = ?${toolRange.sql}
      GROUP BY tc.tool_name
      ORDER BY failedCount DESC, totalDurationMs DESC, callCount DESC
    `).all(roomId, ...toolRange.params)

    const errorCodes = db.prepare(`
      SELECT
        tc.tool_name toolName,
        COALESCE(tc.error_code, 'UNKNOWN_ERROR') errorCode,
        COUNT(*) count,
        MAX(tc.finished_at) lastOccurredAt,
        (SELECT x.error_message FROM agent_tool_calls x
         WHERE x.room_id = tc.room_id AND x.tool_name = tc.tool_name AND COALESCE(x.error_code, 'UNKNOWN_ERROR') = COALESCE(tc.error_code, 'UNKNOWN_ERROR')
         ORDER BY x.finished_at DESC LIMIT 1) sampleMessage
      FROM agent_tool_calls tc
      WHERE tc.room_id = ? AND tc.status = 'failed'${toolRange.sql}
      GROUP BY tc.tool_name, COALESCE(tc.error_code, 'UNKNOWN_ERROR')
      ORDER BY count DESC, lastOccurredAt DESC
    `).all(roomId, ...toolRange.params)

    const recentErrors = db.prepare(`
      SELECT tc.id, tc.run_id runId, tc.agent_id agentId, COALESCE(a.name, tc.agent_id) agentName,
             tc.tool_name toolName, tc.action, tc.error_code errorCode, tc.error_message errorMessage,
             tc.started_at startedAt, tc.duration_ms durationMs
      FROM agent_tool_calls tc
      LEFT JOIN agents a ON a.id = tc.agent_id
      WHERE tc.room_id = ? AND tc.status = 'failed'${toolRange.sql}
      ORDER BY tc.started_at DESC
      LIMIT 20
    `).all(roomId, ...toolRange.params)

    return { range: { from, to }, summary: this.normalizeNumbers(summary || {}), agents: agents.map((x: any) => this.normalizeNumbers(x)), tools: tools.map((x: any) => this.normalizeNumbers(x)), errorCodes: errorCodes.map((x: any) => this.normalizeNumbers(x)), recentErrors: recentErrors.map((x: any) => this.normalizeNumbers(x)) }
  }

  getRuns(roomId: string, query: any = {}) {
    const from = maybeNumber(query.from)
    const to = maybeNumber(query.to)
    const range = whereRange('ar', from, to)
    const limit = Math.min(MAX_LIMIT, Math.max(1, toInt(query.pageSize || query.limit || DEFAULT_LIMIT)))
    const page = Math.max(1, toInt(query.page || 1))
    const offset = (page - 1) * limit
    const agentFilter = query.agentId ? ' AND ar.agent_id = ?' : ''
    const params = [roomId, ...range.params, ...(query.agentId ? [String(query.agentId)] : [])]
    const items = db.prepare(`
      SELECT ar.id runId, ar.agent_id agentId, COALESCE(a.name, ar.agent_id) agentName, ar.status,
             substr(ar.input, 1, 240) inputPreview, substr(COALESCE(ar.output, ar.error, ''), 1, 240) outputPreview,
             ar.started_at startedAt, ar.finished_at finishedAt, ar.duration_ms durationMs,
             ar.input_tokens inputTokens, ar.output_tokens outputTokens,
             ar.cache_creation_input_tokens cacheCreationInputTokens, ar.cache_read_input_tokens cacheReadInputTokens,
             ar.total_tokens totalTokens, ar.tool_call_count toolCallCount, ar.tool_duration_ms toolDurationMs
      FROM agent_runs ar
      LEFT JOIN agents a ON a.id = ar.agent_id
      WHERE ar.room_id = ?${range.sql}${agentFilter}
      ORDER BY ar.started_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset).map((x: any) => this.normalizeNumbers(x))
    const total = (db.prepare(`SELECT COUNT(*) total FROM agent_runs ar WHERE ar.room_id = ?${range.sql}${agentFilter}`).get(...params) as any)?.total || 0
    return { items, total: toInt(total), page, pageSize: limit }
  }

  getRunDetail(roomId: string, runId: string) {
    const run = db.prepare(`
      SELECT ar.id runId, ar.room_id roomId, ar.agent_id agentId, COALESCE(a.name, ar.agent_id) agentName,
             ar.status, ar.input, ar.output, ar.error, ar.started_at startedAt, ar.finished_at finishedAt,
             ar.duration_ms durationMs, ar.input_tokens inputTokens, ar.output_tokens outputTokens,
             ar.cache_creation_input_tokens cacheCreationInputTokens, ar.cache_read_input_tokens cacheReadInputTokens,
             ar.total_tokens totalTokens, ar.tool_call_count toolCallCount, ar.tool_duration_ms toolDurationMs
      FROM agent_runs ar
      LEFT JOIN agents a ON a.id = ar.agent_id
      WHERE ar.room_id = ? AND ar.id = ?
    `).get(roomId, runId) as any
    if (!run) throw { code: 'RUN_NOT_FOUND', message: 'Agent run not found' }
    const toolCalls = db.prepare(`
      SELECT id, tool_name toolName, action, status, error_code errorCode, error_message errorMessage,
             input_summary inputSummary, output_summary outputSummary, started_at startedAt, finished_at finishedAt, duration_ms durationMs
      FROM agent_tool_calls
      WHERE room_id = ? AND run_id = ?
      ORDER BY started_at ASC
    `).all(roomId, runId).map((x: any) => this.normalizeNumbers(x))
    return { run: this.normalizeNumbers(run), toolCalls }
  }

  private normalizeNumbers(row: any) {
    const out: any = { ...row }
    for (const key of Object.keys(out)) {
      if (/Count$|Tokens$|Ms$|At$|Rate$|total$|page$|pageSize$|failedCount$|successCount$|timeoutCount$|runCount$|count$/.test(key) && out[key] !== null && out[key] !== undefined) {
        const n = Number(out[key])
        if (Number.isFinite(n)) out[key] = n
      }
    }
    if (out.callCount !== undefined && out.failedCount !== undefined) out.failureRate = out.callCount ? out.failedCount / out.callCount : 0
    return out
  }
}

export const roomAnalyticsService = new RoomAnalyticsService()
