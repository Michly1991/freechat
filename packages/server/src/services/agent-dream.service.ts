import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { classifyDreamSignals, type DreamErrorInput, type DreamSignal } from './agent-dream-rules.js'
import { mergeAgentConfig } from './agent-mapper.js'
import type { AgentRuntimeConfig } from '@freechat/shared'

interface DreamRunOptions {
  date?: string
  roomId?: string
  agentId?: string
  dryRun?: boolean
}

const DAY = 24 * 60 * 60 * 1000
const MAX_DREAM_MEMORY = 10

function dateKey(ts: number) {
  return new Date(ts).toISOString().slice(0, 10)
}

function dayRange(date?: string) {
  if (date) {
    const start = new Date(`${date}T00:00:00.000Z`).getTime()
    return { date, start, end: start + DAY }
  }
  const todayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime()
  const start = todayStart - DAY
  return { date: dateKey(start), start, end: todayStart }
}

function parseConfig(raw?: string | null): AgentRuntimeConfig {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

function normalizeMemory(config: AgentRuntimeConfig, signals: DreamSignal[], now: number) {
  const existing = Array.isArray(config.dreamMemory) ? config.dreamMemory : []
  const byType = new Map(existing.map((item) => [item.type, { ...item }]))
  for (const signal of signals) {
    const prev = byType.get(signal.type)
    byType.set(signal.type, {
      type: signal.type,
      text: signal.text,
      source: 'dream',
      count: (prev?.count || 0) + signal.count,
      lastTriggeredAt: Math.max(prev?.lastTriggeredAt || 0, signal.lastTriggeredAt || now),
    })
  }
  return Array.from(byType.values())
    .sort((a, b) => (b.lastTriggeredAt || 0) - (a.lastTriggeredAt || 0))
    .slice(0, MAX_DREAM_MEMORY)
}

class AgentDreamService {
  runDreams(options: DreamRunOptions = {}) {
    const { date, start, end } = dayRange(options.date)
    const agents = this.getAgentsWithErrors(start, end, options)
    return agents.map((agent) => this.runAgentDream(agent, { ...options, date }, start, end))
  }

  listDreams(roomId?: string, limit = 50) {
    const where = roomId ? 'WHERE d.room_id = ?' : ''
    const rows = db.prepare(`
      SELECT d.*, a.name as agent_name, r.name as room_name
      FROM agent_dreams d
      LEFT JOIN agents a ON a.id = d.agent_id
      LEFT JOIN rooms r ON r.id = d.room_id
      ${where}
      ORDER BY d.created_at DESC
      LIMIT ?
    `).all(...(roomId ? [roomId, limit] : [limit])) as any[]
    return rows.map((row) => ({
      id: row.id,
      roomId: row.room_id,
      roomName: row.room_name,
      agentId: row.agent_id,
      agentName: row.agent_name,
      date: row.dream_date,
      status: row.status,
      errorCount: row.error_count,
      summary: row.summary,
      proposedChanges: row.proposed_changes_json ? JSON.parse(row.proposed_changes_json) : [],
      appliedChanges: row.applied_changes_json ? JSON.parse(row.applied_changes_json) : [],
      createdAt: row.created_at,
      appliedAt: row.applied_at,
    }))
  }

  getDream(id: string) {
    const row = db.prepare(`
      SELECT d.*, a.name as agent_name, r.name as room_name
      FROM agent_dreams d
      LEFT JOIN agents a ON a.id = d.agent_id
      LEFT JOIN rooms r ON r.id = d.room_id
      WHERE d.id = ?
    `).get(id) as any
    if (!row) throw { code: 'DREAM_NOT_FOUND', message: 'Dream not found' }
    const fixes = db.prepare('SELECT * FROM agent_dream_fixes WHERE dream_id = ? ORDER BY created_at ASC').all(id) as any[]
    return { ...this.listDreams(row.room_id, 200).find((item) => item.id === id), fixes }
  }

  private getAgentsWithErrors(start: number, end: number, options: DreamRunOptions) {
    const conditions = ['x.started_at >= ?', 'x.started_at < ?']
    const params: any[] = [start, end]
    if (options.roomId) { conditions.push('x.room_id = ?'); params.push(options.roomId) }
    if (options.agentId) { conditions.push('x.agent_id = ?'); params.push(options.agentId) }
    return db.prepare(`
      SELECT DISTINCT x.room_id as roomId, x.agent_id as agentId
      FROM (
        SELECT room_id, agent_id, started_at FROM agent_runs WHERE status != 'completed' OR error IS NOT NULL
        UNION ALL
        SELECT room_id, agent_id, started_at FROM agent_tool_calls WHERE status != 'success'
      ) x
      WHERE ${conditions.join(' AND ')}
    `).all(...params) as { roomId: string; agentId: string }[]
  }

  private collectErrors(roomId: string, agentId: string, start: number, end: number): DreamErrorInput[] {
    const runs = db.prepare(`
      SELECT status, error as errorMessage, started_at as createdAt FROM agent_runs
      WHERE room_id = ? AND agent_id = ? AND started_at >= ? AND started_at < ? AND (status != 'completed' OR error IS NOT NULL)
    `).all(roomId, agentId, start, end) as any[]
    const tools = db.prepare(`
      SELECT tool_name as toolName, status, error_code as errorCode, error_message as errorMessage, started_at as createdAt
      FROM agent_tool_calls
      WHERE room_id = ? AND agent_id = ? AND started_at >= ? AND started_at < ? AND status != 'success'
    `).all(roomId, agentId, start, end) as any[]
    return [...runs, ...tools]
  }

  private runAgentDream(target: { roomId: string; agentId: string }, options: DreamRunOptions & { date: string }, start: number, end: number) {
    const now = Date.now()
    const errors = this.collectErrors(target.roomId, target.agentId, start, end)
    const signals = classifyDreamSignals(errors)
    const summary = signals.length
      ? `梦境复盘发现 ${errors.length} 条失败信号，应用 ${signals.length} 条避错记忆：${signals.map((s) => s.type).join('、')}。`
      : `梦境复盘发现 ${errors.length} 条失败信号，但没有可安全自动修复的规则。`
    const dreamId = `dream_${uuidv4()}`
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(target.agentId) as any
    const beforeConfig = parseConfig(agent?.config)
    const beforeMemory = beforeConfig.dreamMemory || []
    const afterMemory = normalizeMemory(beforeConfig, signals, now)
    const applied = signals.map((signal) => ({ targetType: 'agent_config.dreamMemory', type: signal.type, text: signal.text, reason: signal.reason, count: signal.count }))
    const status = options.dryRun ? 'proposed' : (applied.length ? 'applied' : 'no_safe_fix')

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO agent_dreams (id, room_id, agent_id, dream_date, status, error_count, summary, proposed_changes_json, applied_changes_json, created_at, applied_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(room_id, agent_id, dream_date) DO UPDATE SET
          id = excluded.id, status = excluded.status, error_count = excluded.error_count, summary = excluded.summary,
          proposed_changes_json = excluded.proposed_changes_json, applied_changes_json = excluded.applied_changes_json,
          created_at = excluded.created_at, applied_at = excluded.applied_at
      `).run(dreamId, target.roomId, target.agentId, options.date, status, errors.length, summary, JSON.stringify(applied), JSON.stringify(options.dryRun ? [] : applied), now, options.dryRun || !applied.length ? null : now)
      if (!options.dryRun && applied.length && agent) {
        const merged = mergeAgentConfig(agent.role_type, { ...beforeConfig, dreamMemory: afterMemory } as any)
        db.prepare('UPDATE agents SET config = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(merged), now, target.agentId)
        db.prepare('DELETE FROM agent_dream_fixes WHERE dream_id = ?').run(dreamId)
        for (const signal of signals) {
          db.prepare(`
            INSERT INTO agent_dream_fixes (id, dream_id, agent_id, target_type, target_id, before_text, after_text, reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(`dream_fix_${uuidv4()}`, dreamId, target.agentId, 'agent_config.dreamMemory', signal.type, JSON.stringify(beforeMemory), signal.text, signal.reason, now)
        }
      }
    })
    tx()
    return { id: dreamId, roomId: target.roomId, agentId: target.agentId, date: options.date, status, errorCount: errors.length, summary, proposedChanges: applied, appliedChanges: options.dryRun ? [] : applied }
  }
}

export const agentDreamService = new AgentDreamService()
