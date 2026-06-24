import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'

interface GrowthRunOptions { roomId?: string; date?: string }
interface ProposalSeed { scope: 'room' | 'agent'; agentId?: string | null; type: string; text: string; confidence: number; evidence: string[] }

const DAY = 24 * 60 * 60 * 1000
const MAX_EVIDENCE = 3

function dateKey(ts: number) { return new Date(ts).toISOString().slice(0, 10) }
function dayRange(date?: string) {
  if (date) {
    const start = new Date(`${date}T00:00:00.000Z`).getTime()
    return { date, start, end: start + DAY }
  }
  const todayStart = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime()
  const start = todayStart - DAY
  return { date: dateKey(start), start, end: todayStart }
}
function safeText(text: string) { return text.replace(/sk-[A-Za-z0-9_-]{16,}/g, '[redacted]').replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/g, '[redacted]').trim() }
function normalize(text: string) { return safeText(text).replace(/\s+/g, '').toLowerCase() }
function parseJson(raw?: string | null, fallback: any = []) { try { return raw ? JSON.parse(raw) : fallback } catch { return fallback } }

class AgentGrowthService {
  runGrowthReview(options: GrowthRunOptions = {}) {
    const { date, start, end } = dayRange(options.date)
    const rooms = options.roomId ? [{ id: options.roomId }] : db.prepare('SELECT id FROM rooms WHERE deleted = 0').all() as any[]
    return rooms.map((room) => this.runRoomReview(room.id, date, start, end))
  }

  listGrowth(roomId: string) {
    return {
      reviews: this.listReviews(roomId),
      proposals: this.listProposals(roomId),
      memories: this.listMemories(roomId),
    }
  }

  listReviews(roomId: string, limit = 20) {
    return (db.prepare(`SELECT * FROM agent_growth_reviews WHERE room_id = ? ORDER BY created_at DESC LIMIT ?`).all(roomId, limit) as any[])
      .map((row) => ({ id: row.id, roomId: row.room_id, date: row.review_date, status: row.status, summary: row.summary, createdAt: row.created_at }))
  }

  listProposals(roomId: string, status?: string, limit = 80) {
    const whereStatus = status ? ' AND p.status = ?' : ''
    const params = status ? [roomId, status, limit] : [roomId, limit]
    return (db.prepare(`
      SELECT p.*, a.name agent_name FROM agent_memory_proposals p
      LEFT JOIN agents a ON a.id = p.agent_id
      WHERE p.room_id = ?${whereStatus}
      ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.created_at DESC
      LIMIT ?
    `).all(...params) as any[]).map((row) => this.mapProposal(row))
  }

  listMemories(roomId: string) {
    return (db.prepare(`
      SELECT m.*, a.name agent_name FROM agent_memories m
      LEFT JOIN agents a ON a.id = m.agent_id
      WHERE m.room_id = ? AND m.enabled = 1
      ORDER BY m.updated_at DESC
    `).all(roomId) as any[]).map((row) => this.mapMemory(row))
  }

  getEffectiveMemories(roomId: string, agentId?: string, limit = 12) {
    return (db.prepare(`
      SELECT * FROM agent_memories
      WHERE room_id = ? AND enabled = 1 AND (scope = 'room' OR agent_id = ?)
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(roomId, agentId || '', limit) as any[]).map((row) => this.mapMemory(row))
  }

  getProposalRoomId(id: string) {
    const row = db.prepare('SELECT room_id FROM agent_memory_proposals WHERE id = ?').get(id) as any
    if (!row) throw { code: 'PROPOSAL_NOT_FOUND', message: 'Growth proposal not found' }
    return row.room_id as string
  }

  getMemoryRoomId(id: string) {
    const row = db.prepare('SELECT room_id FROM agent_memories WHERE id = ?').get(id) as any
    if (!row) throw { code: 'MEMORY_NOT_FOUND', message: 'Growth memory not found' }
    return row.room_id as string
  }

  acceptProposal(id: string) {
    const proposal = db.prepare('SELECT * FROM agent_memory_proposals WHERE id = ?').get(id) as any
    if (!proposal) throw { code: 'PROPOSAL_NOT_FOUND', message: 'Growth proposal not found' }
    const now = Date.now()
    const existing = this.findSimilarMemory(proposal.room_id, proposal.agent_id, proposal.scope, proposal.type, proposal.text)
    const memoryId = existing?.id || `mem_${uuidv4()}`
    const tx = db.transaction(() => {
      db.prepare(`UPDATE agent_memory_proposals SET status = 'accepted', decided_at = ? WHERE id = ?`).run(now, id)
      if (existing) {
        db.prepare(`UPDATE agent_memories SET text = ?, confidence = ?, source_proposal_id = ?, enabled = 1, updated_at = ? WHERE id = ?`)
          .run(proposal.text, proposal.confidence || 0, id, now, memoryId)
      } else {
        db.prepare(`
          INSERT INTO agent_memories (id, room_id, agent_id, scope, type, text, source_proposal_id, confidence, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(memoryId, proposal.room_id, proposal.agent_id || null, proposal.scope, proposal.type, proposal.text, id, proposal.confidence || 0, now, now)
      }
    })
    tx()
    return this.mapMemory(db.prepare('SELECT m.*, a.name agent_name FROM agent_memories m LEFT JOIN agents a ON a.id = m.agent_id WHERE m.id = ?').get(memoryId) as any)
  }

  rejectProposal(id: string) {
    const now = Date.now()
    const info = db.prepare(`UPDATE agent_memory_proposals SET status = 'rejected', decided_at = ? WHERE id = ?`).run(now, id)
    if (!info.changes) throw { code: 'PROPOSAL_NOT_FOUND', message: 'Growth proposal not found' }
    return { id, status: 'rejected' }
  }

  deleteMemory(id: string) {
    const info = db.prepare('UPDATE agent_memories SET enabled = 0, updated_at = ? WHERE id = ?').run(Date.now(), id)
    if (!info.changes) throw { code: 'MEMORY_NOT_FOUND', message: 'Growth memory not found' }
    return { id, enabled: false }
  }

  private runRoomReview(roomId: string, date: string, start: number, end: number) {
    const now = Date.now()
    const seeds = this.collectProposalSeeds(roomId, start, end)
    const existingReview = db.prepare('SELECT id FROM agent_growth_reviews WHERE room_id = ? AND review_date = ?').get(roomId, date) as any
    const reviewId = existingReview?.id || `growth_${uuidv4()}`
    const summary = seeds.length ? `成长复盘发现 ${seeds.length} 条候选用户/项目习惯，等待用户确认。` : '成长复盘未发现新的可确认习惯。'
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO agent_growth_reviews (id, room_id, review_date, status, summary, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(room_id, review_date) DO UPDATE SET
          status = excluded.status, summary = excluded.summary, created_at = excluded.created_at
      `).run(reviewId, roomId, date, seeds.length ? 'proposed' : 'empty', summary, now)
      for (const seed of seeds) {
        if (this.hasSimilarProposalOrMemory(roomId, seed)) continue
        db.prepare(`
          INSERT INTO agent_memory_proposals (id, review_id, room_id, agent_id, scope, type, text, confidence, evidence_json, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(`prop_${uuidv4()}`, reviewId, roomId, seed.agentId || null, seed.scope, seed.type, seed.text, seed.confidence, JSON.stringify(seed.evidence.slice(0, MAX_EVIDENCE)), now)
      }
    })
    tx()
    return { id: reviewId, roomId, date, status: seeds.length ? 'proposed' : 'empty', summary, proposalCount: seeds.length }
  }

  private collectProposalSeeds(roomId: string, start: number, end: number): ProposalSeed[] {
    const rows = db.prepare(`
      SELECT actor_id actorId, actor_name actorName, actor_role actorRole, content, created_at createdAt
      FROM messages
      WHERE room_id = ? AND created_at >= ? AND created_at < ? AND deleted = 0 AND actor_role = 'human'
      ORDER BY created_at ASC
      LIMIT 300
    `).all(roomId, start, end) as any[]
    const seeds: ProposalSeed[] = []
    const push = (type: string, text: string, confidence: number, evidence: string[]) => seeds.push({ scope: 'room', type, text, confidence, evidence: evidence.map(safeText).filter(Boolean) })
    const contents = rows.map((r) => safeText(String(r.content || ''))).filter(Boolean)
    const joined = contents.join('\n')

    const boundaryEvidence = contents.filter((c) => /先不(搞|做)|不搞了|后面再看|算了|暂时不|先放一放/.test(c)).slice(-MAX_EVIDENCE)
    if (boundaryEvidence.length) push('feature_boundary', '用户明确暂缓的功能方向，Agent 不应主动推进；除非用户重新提起，应先确认再继续设计或开发。', 0.78, boundaryEvidence)

    const designEvidence = contents.filter((c) => /先聊|系分|系统设计|架构方案|确认后|确认再|别直接开发|不要.*直接/.test(c)).slice(-MAX_EVIDENCE)
    if (designEvidence.length || /先聊系分/.test(joined)) push('workflow_preference', '涉及功能、代码或架构变更时，先讨论系统设计和范围，用户明确确认后再开发。', 0.94, designEvidence.length ? designEvidence : ['用户长期规则：先聊系分，确认后才能开发。'])

    const costEvidence = contents.filter((c) => /收费|多少钱|成本|不用钱|云服务|按量|费用/.test(c)).slice(-MAX_EVIDENCE)
    if (costEvidence.length) push('cost_preference', '涉及云服务、外部 API、模型调用或可能产生费用的能力时，必须先说明成本、替代方案和是否默认关闭。', 0.86, costEvidence)

    const docEvidence = contents.filter((c) => /文档|设计文档|同步|pnpm check|提交|commit|私密|api[-_ ]?key|配置文件/.test(c)).slice(-MAX_EVIDENCE)
    if (docEvidence.length) push('engineering_rule', '项目改动应同步设计文档，提交前运行检查；不要提交本地私密配置或真实 API Key。', 0.88, docEvidence)

    const notifyEvidence = contents.filter((c) => /通知|音效|不吵|可控|强提醒|普通消息/.test(c)).slice(-MAX_EVIDENCE)
    if (notifyEvidence.length) push('ux_preference', '通知和提醒功能应默认克制：强提醒可明显反馈，普通消息默认不打扰，并提供用户可控开关。', 0.82, notifyEvidence)

    const agentEvidence = contents.filter((c) => /Agent|协调者|协作|分派|任务计划|自己成长|用户习惯|梦境/.test(c)).slice(-MAX_EVIDENCE)
    if (agentEvidence.length) push('agent_collaboration_preference', '协调者应作为入口和分流者，复杂事项先给计划或创建任务计划预览，再按确认分派给合适 Agent。', 0.8, agentEvidence)

    return this.dedupeSeeds(seeds)
  }

  private dedupeSeeds(seeds: ProposalSeed[]) {
    const seen = new Set<string>()
    return seeds.filter((seed) => {
      const key = `${seed.scope}:${seed.type}:${normalize(seed.text)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  private hasSimilarProposalOrMemory(roomId: string, seed: ProposalSeed) {
    const textKey = normalize(seed.text)
    const proposals = db.prepare(`SELECT text FROM agent_memory_proposals WHERE room_id = ? AND scope = ? AND type = ? AND status = 'pending'`).all(roomId, seed.scope, seed.type) as any[]
    if (proposals.some((p) => normalize(p.text) === textKey)) return true
    return !!this.findSimilarMemory(roomId, seed.agentId || null, seed.scope, seed.type, seed.text)
  }

  private findSimilarMemory(roomId: string, agentId: string | null, scope: string, type: string, text: string) {
    const rows = db.prepare(`SELECT * FROM agent_memories WHERE room_id = ? AND scope = ? AND type = ? AND enabled = 1`).all(roomId, scope, type) as any[]
    const textKey = normalize(text)
    return rows.find((row) => normalize(row.text) === textKey || (row.agent_id || null) === (agentId || null))
  }

  private mapProposal(row: any) {
    return {
      id: row.id, reviewId: row.review_id, roomId: row.room_id, agentId: row.agent_id, agentName: row.agent_name,
      scope: row.scope, type: row.type, text: row.text, confidence: Number(row.confidence || 0), evidence: parseJson(row.evidence_json),
      status: row.status, createdAt: row.created_at, decidedAt: row.decided_at,
    }
  }

  private mapMemory(row: any) {
    return {
      id: row.id, roomId: row.room_id, agentId: row.agent_id, agentName: row.agent_name,
      scope: row.scope, type: row.type, text: row.text, confidence: Number(row.confidence || 0), enabled: row.enabled === 1,
      sourceProposalId: row.source_proposal_id, createdAt: row.created_at, updatedAt: row.updated_at,
    }
  }
}

export const agentGrowthService = new AgentGrowthService()
