import db from '../storage/db.js'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { roomService } from './room.service.js'
import { agentService } from './agent.service.js'
import { messageService } from './message.service.js'

export type WorkgroupRole = 'owner' | 'admin' | 'member' | 'viewer'

type RoomCreateParticipant = string | { id?: string; name?: string; userId?: string; agentId?: string; autoEnabled?: boolean; priority?: number }

type CreateRoomInput = {
  name: string
  description?: string
  kind?: string
  members?: RoomCreateParticipant[]
  agents?: RoomCreateParticipant[]
  autoAgent?: string
  includeActor?: boolean
  initialMessage?: string
  reason?: string
}

function now() { return Date.now() }

function normalize(text: any) { return String(text || '').trim().toLowerCase() }

function asList(value: any): any[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean)
  return [value]
}

function userLabel(row: any) { return row.nickname || row.username || row.user_id || row.id }
function hashToken(token: string) { return crypto.createHash('sha256').update(token).digest('hex') }
function makeEntryToken() { return crypto.randomBytes(24).toString('base64url') }
function makeShareToken() { return crypto.randomBytes(18).toString('base64url') }
function publicShareLink(row: any) { return row ? { id: row.id, entryId: row.entry_id, sharerUserId: row.sharer_user_id, sharerName: row.sharer_name, token: row.token, enabled: !!row.enabled, visitCount: row.visit_count || 0, joinCount: row.join_count || 0, lastUsedAt: row.last_used_at, createdAt: row.created_at } : null }
function publicEntry(row: any, token?: string, extra: any = {}) { return row ? { id: row.id, workgroupId: row.workgroup_id, agentId: row.agent_id, agentName: row.agent_name, title: row.title, description: row.description, accessMode: row.access_mode, enabled: !!row.enabled, welcomeMessage: row.welcome_message, maxUses: row.max_uses, usedCount: row.used_count || 0, expiresAt: row.expires_at, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, token: token || row.token, ...extra } : null }


export class WorkgroupEntryService {
  assertUserInWorkgroup(workgroupId: string, userId: string): any { throw new Error('not implemented') }
  assertCanManage(workgroupId: string, userId: string): any { throw new Error('not implemented') }
  listMembers(workgroupId: string): any[] { throw new Error('not implemented') }
  listAgents(workgroupId: string): any[] { throw new Error('not implemented') }
  getRoomWorkgroup(roomId: string): any { throw new Error('not implemented') }
  assignRoomToWorkgroup(roomId: string, workgroupId: string): any { throw new Error('not implemented') }
  listEntries(workgroupId: string, viewerUserId?: string) {
    const rows = db.prepare(`
      SELECT e.*, a.name agent_name
      FROM workgroup_entries e
      JOIN agents a ON a.id = e.agent_id
      WHERE e.workgroup_id = ?
      ORDER BY e.created_at DESC
    `).all(workgroupId) as any[]
    return rows.map((row) => {
      const myShareLink = viewerUserId ? this.ensureEntryShareLink(row.id, workgroupId, viewerUserId) : null
      return publicEntry(row, undefined, { myShareLink })
    })
  }

  ensureEntryShareLink(entryId: string, workgroupId: string, sharerUserId: string) {
    const member = db.prepare(`
      SELECT wm.user_id, wm.role, u.username, u.nickname, u.identity_type
      FROM workgroup_members wm JOIN users u ON u.id = wm.user_id
      WHERE wm.workgroup_id = ? AND wm.user_id = ?
    `).get(workgroupId, sharerUserId) as any
    if (!member || (member.identity_type || 'human') !== 'human') return null
    const existing = db.prepare(`
      SELECT sl.*, COALESCE(u.nickname, u.username) sharer_name
      FROM workgroup_entry_share_links sl
      JOIN users u ON u.id = sl.sharer_user_id
      WHERE sl.entry_id = ? AND sl.sharer_user_id = ?
    `).get(entryId, sharerUserId) as any
    if (existing) return publicShareLink(existing)
    const token = makeShareToken()
    const id = `wges_${uuidv4()}`
    const ts = now()
    db.prepare(`
      INSERT INTO workgroup_entry_share_links (id, workgroup_id, entry_id, sharer_user_id, token_hash, token, enabled, visit_count, join_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)
    `).run(id, workgroupId, entryId, sharerUserId, hashToken(token), token, ts, ts)
    return publicShareLink(db.prepare(`
      SELECT sl.*, COALESCE(u.nickname, u.username) sharer_name
      FROM workgroup_entry_share_links sl
      JOIN users u ON u.id = sl.sharer_user_id
      WHERE sl.id = ?
    `).get(id) as any)
  }



  getEntryAnalytics(workgroupId: string, entryId: string, userId: string) {
    const membership = this.assertUserInWorkgroup(workgroupId, userId)
    const canManage = ['owner', 'admin'].includes(membership.role)
    const entry = db.prepare(`
      SELECT e.*, a.name agent_name
      FROM workgroup_entries e
      JOIN agents a ON a.id = e.agent_id
      WHERE e.workgroup_id = ? AND e.id = ?
    `).get(workgroupId, entryId) as any
    if (!entry) throw { code: 'ENTRY_NOT_FOUND', message: 'Workgroup entry not found' }
    const params: any[] = [entryId]
    const scopeSql = canManage ? '' : 'AND sl.sharer_user_id = ?'
    if (!canManage) params.push(userId)
    const links = db.prepare(`
      SELECT sl.*, COALESCE(u.nickname, u.username) sharer_name,
        COUNT(DISTINCT CASE WHEN ev.event_type = 'view' THEN ev.id END) event_visit_count,
        COUNT(DISTINCT CASE WHEN ev.event_type = 'join' THEN ev.id END) event_join_count,
        COUNT(DISTINCT r.id) room_count,
        COALESCE(SUM(ble.amount), 0) credits,
        COALESCE(SUM(CAST(json_extract(ble.token_snapshot_json, '$.totalTokens') AS INTEGER)), 0) total_tokens,
        COALESCE(SUM(CAST(json_extract(ble.token_snapshot_json, '$.inputTokens') AS INTEGER)), 0) input_tokens,
        COALESCE(SUM(CAST(json_extract(ble.token_snapshot_json, '$.outputTokens') AS INTEGER)), 0) output_tokens
      FROM workgroup_entry_share_links sl
      JOIN users u ON u.id = sl.sharer_user_id
      LEFT JOIN workgroup_entry_share_events ev ON ev.share_link_id = sl.id
      LEFT JOIN rooms r ON r.workgroup_entry_share_link_id = sl.id AND r.deleted_at IS NULL
      LEFT JOIN billing_ledger_entries ble ON ble.room_id = r.id AND ble.account_role = 'payer'
      WHERE sl.entry_id = ? ${scopeSql}
      GROUP BY sl.id
      ORDER BY sl.join_count DESC, sl.visit_count DESC, sl.created_at DESC
    `).all(...params) as any[]
    const normalized = links.map((row: any) => ({
      ...publicShareLink(row),
      eventVisitCount: row.event_visit_count || 0,
      eventJoinCount: row.event_join_count || 0,
      roomCount: row.room_count || 0,
      credits: row.credits || 0,
      totalTokens: row.total_tokens || 0,
      inputTokens: row.input_tokens || 0,
      outputTokens: row.output_tokens || 0,
    }))
    const summary = normalized.reduce((acc: any, row: any) => {
      acc.visitCount += row.visitCount || 0
      acc.joinCount += row.joinCount || 0
      acc.roomCount += row.roomCount || 0
      acc.credits += row.credits || 0
      acc.totalTokens += row.totalTokens || 0
      acc.inputTokens += row.inputTokens || 0
      acc.outputTokens += row.outputTokens || 0
      return acc
    }, { visitCount: 0, joinCount: 0, roomCount: 0, credits: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0 })
    return { entry: publicEntry(entry), scope: canManage ? 'workgroup' : 'self', summary, links: normalized }
  }

  createEntry(workgroupId: string, userId: string, input: any) {
    this.assertCanManage(workgroupId, userId)
    const agent = this.resolveAgent(workgroupId, input.agentId || input.agent || input.id)
    const title = String(input.title || '').trim()
    if (!title) throw { code: 'VALIDATION_ERROR', message: 'title is required' }
    const token = makeEntryToken()
    const id = `wge_${uuidv4()}`
    const ts = now()
    db.prepare(`
      INSERT INTO workgroup_entries (id, workgroup_id, agent_id, title, description, access_mode, token_hash, token, enabled, welcome_message, max_uses, used_count, expires_at, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?, ?, ?)
    `).run(id, workgroupId, agent.id, title, input.description || null, input.accessMode || 'private_link', hashToken(token), token, input.welcomeMessage || null, input.maxUses || null, input.expiresAt || null, userId, ts, ts)
    const row = db.prepare('SELECT e.*, a.name agent_name FROM workgroup_entries e JOIN agents a ON a.id = e.agent_id WHERE e.id = ?').get(id) as any
    const entry = publicEntry(row, token) as any
    this.ensureEntryShareLink(id, workgroupId, userId)
    return entry
  }

  updateEntry(workgroupId: string, entryId: string, userId: string, input: any) {
    this.assertCanManage(workgroupId, userId)
    const current = db.prepare('SELECT * FROM workgroup_entries WHERE id = ? AND workgroup_id = ?').get(entryId, workgroupId) as any
    if (!current) throw { code: 'ENTRY_NOT_FOUND', message: 'Workgroup entry not found' }
    const updates: string[] = []
    const values: any[] = []
    if (input.title !== undefined) { updates.push('title = ?'); values.push(String(input.title).trim()) }
    if (input.description !== undefined) { updates.push('description = ?'); values.push(input.description || null) }
    if (input.welcomeMessage !== undefined) { updates.push('welcome_message = ?'); values.push(input.welcomeMessage || null) }
    if (input.enabled !== undefined) { updates.push('enabled = ?'); values.push(input.enabled ? 1 : 0) }
    if (input.maxUses !== undefined) { updates.push('max_uses = ?'); values.push(input.maxUses ? Number(input.maxUses) : null) }
    if (input.expiresAt !== undefined) { updates.push('expires_at = ?'); values.push(input.expiresAt ? Number(input.expiresAt) : null) }
    if (input.agentId !== undefined) { const agent = this.resolveAgent(workgroupId, input.agentId); updates.push('agent_id = ?'); values.push(agent.id) }
    if (!updates.length) return publicEntry(db.prepare('SELECT e.*, a.name agent_name FROM workgroup_entries e JOIN agents a ON a.id = e.agent_id WHERE e.id = ?').get(entryId) as any)
    updates.push('updated_at = ?'); values.push(now(), entryId, workgroupId)
    db.prepare(`UPDATE workgroup_entries SET ${updates.join(', ')} WHERE id = ? AND workgroup_id = ?`).run(...values)
    return publicEntry(db.prepare('SELECT e.*, a.name agent_name FROM workgroup_entries e JOIN agents a ON a.id = e.agent_id WHERE e.id = ?').get(entryId) as any)
  }

  deleteEntry(workgroupId: string, entryId: string, userId: string) {
    this.assertCanManage(workgroupId, userId)
    db.prepare('DELETE FROM workgroup_entries WHERE id = ? AND workgroup_id = ?').run(entryId, workgroupId)
  }

  getEntryByToken(token: string, refToken?: string, viewerUserId?: string) {
    const row = db.prepare(`
      SELECT e.*, wg.name workgroup_name, wg.description workgroup_description, a.name agent_name, a.description agent_description
      FROM workgroup_entries e
      JOIN workgroups wg ON wg.id = e.workgroup_id
      JOIN agents a ON a.id = e.agent_id
      WHERE e.token_hash = ?
    `).get(hashToken(token)) as any
    if (!row || !row.enabled) throw { code: 'ENTRY_NOT_FOUND', message: '分享入口不存在或已停用' }
    if (row.expires_at && row.expires_at < now()) throw { code: 'ENTRY_EXPIRED', message: '分享入口已过期' }
    if (row.max_uses && row.used_count >= row.max_uses) throw { code: 'ENTRY_EXPIRED', message: '分享入口使用次数已满' }
    const rawShareLink = refToken ? this.resolveEntryShareLink(row.id, refToken) : null
    this.recordShareEvent(row, rawShareLink, viewerUserId, 'view')
    return { ...publicEntry(row, undefined, { shareLink: publicShareLink(rawShareLink) }), workgroupName: row.workgroup_name, workgroupDescription: row.workgroup_description, agentDescription: row.agent_description }
  }

  resolveEntryShareLink(entryId: string, refToken?: string) {
    if (!refToken) return null
    const row = db.prepare(`
      SELECT sl.*, COALESCE(u.nickname, u.username) sharer_name
      FROM workgroup_entry_share_links sl
      JOIN users u ON u.id = sl.sharer_user_id
      WHERE sl.entry_id = ? AND sl.token_hash = ? AND sl.enabled = 1
    `).get(entryId, hashToken(refToken)) as any
    return row || null
  }

  recordShareEvent(entry: any, shareLink: any, visitorUserId: string | undefined, eventType: 'view' | 'join', roomId?: string) {
    if (eventType === 'view' && !shareLink) return
    const ts = now()
    db.prepare(`
      INSERT INTO workgroup_entry_share_events (id, workgroup_id, entry_id, share_link_id, sharer_user_id, visitor_user_id, event_type, room_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(`wgese_${uuidv4()}`, entry.workgroup_id || entry.workgroupId, entry.id, shareLink?.id || null, shareLink?.sharer_user_id || shareLink?.sharerUserId || null, visitorUserId || null, eventType, roomId || null, ts)
    if (shareLink) db.prepare(`UPDATE workgroup_entry_share_links SET ${eventType === 'join' ? 'join_count = join_count + 1,' : 'visit_count = visit_count + 1,'} last_used_at = ?, updated_at = ? WHERE id = ?`).run(ts, ts, shareLink.id)
  }

  async joinEntry(token: string, userId: string, refToken?: string) {
    const entry = this.getEntryByToken(token, refToken, userId) as any
    const existingRoom = db.prepare(`
      SELECT * FROM rooms
      WHERE room_kind = 'entry' AND workgroup_entry_id = ? AND created_by = ? AND deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `).get(entry.id, userId) as any
    if (existingRoom) {
      return { entry, room: existingRoom }
    }
    const room = await roomService.createRoom(entry.title, entry.description || null, userId, [], [{ agentId: entry.agentId, roomRole: 'assistant', autoEnabled: true, priority: 0 }], { roomKind: 'entry', workgroupId: entry.workgroupId, workgroupEntryId: entry.id, syncInitialMembersToWorkgroup: false })
    if (entry.shareLink) db.prepare('UPDATE rooms SET workgroup_entry_share_link_id = ?, workgroup_entry_sharer_user_id = ? WHERE id = ?').run(entry.shareLink.id, entry.shareLink.sharerUserId, room.id)
    db.prepare('UPDATE workgroup_entries SET used_count = COALESCE(used_count, 0) + 1, updated_at = ? WHERE id = ?').run(now(), entry.id)
    this.recordShareEvent({ ...entry, workgroup_id: entry.workgroupId }, entry.shareLink, userId, 'join', room.id)
    await messageService.createMessage(room.id, 'system', '系统', 'ai', `你正在通过「${entry.title}」分享入口使用「${entry.agentName || 'Agent'}」。本会话为你的独立访客对话；如 Agent 设置了服务费会按 token 计费给 Agent 发布人，模型费按模型规则计费给模型提供方。`, undefined, undefined, 'system_notice', { reason: 'workgroup_entry_joined', entryId: entry.id, agentId: entry.agentId, payerUserId: userId, visitor: true })
    if (entry.welcomeMessage) await messageService.createMessage(room.id, entry.agentId, entry.agentName || 'Agent', 'ai', entry.welcomeMessage, undefined, undefined, 'text')
    return { entry, room }
  }

  resolveMember(workgroupId: string, ref: any) {
    const value = typeof ref === 'object' ? (ref.userId || ref.id || ref.name) : ref
    if (!value) throw { code: 'VALIDATION_ERROR', message: 'member reference is required' }
    const text = String(value).trim()
    const members = this.listMembers(workgroupId)
    const matches = members.filter((m: any) => m.user_id === text || normalize(m.username) === normalize(text) || normalize(m.nickname) === normalize(text) || normalize(userLabel(m)) === normalize(text))
    if (matches.length === 0) throw { code: 'USER_NOT_FOUND', message: `Workgroup member not found: ${text}` }
    if (matches.length > 1) throw { code: 'AMBIGUOUS_MEMBER', message: `Ambiguous workgroup member: ${text}` }
    return matches[0]
  }

  resolveAgent(workgroupId: string, ref: any) {
    const value = typeof ref === 'object' ? (ref.agentId || ref.id || ref.name || ref.agent) : ref
    if (!value) throw { code: 'VALIDATION_ERROR', message: 'agent reference is required' }
    const text = String(value).trim()
    const agents = this.listAgents(workgroupId)
    const matches = agents.filter((a: any) => a.id === text || normalize(a.name) === normalize(text))
    if (matches.length === 0) throw { code: 'AGENT_NOT_FOUND', message: `Workgroup Agent not found: ${text}` }
    if (matches.length > 1) throw { code: 'AMBIGUOUS_AGENT', message: `Ambiguous workgroup Agent: ${text}` }
    return matches[0]
  }

  async createRoomFromWorkgroup(sourceRoomId: string, actorUserId: string, currentAgentId: string, input: CreateRoomInput) {
    const name = String(input.name || '').trim()
    if (!name) throw { code: 'VALIDATION_ERROR', message: 'name is required' }
    const wg = this.getRoomWorkgroup(sourceRoomId)
    const sourceMembers = await roomService.getRoomMembers(sourceRoomId)
    const actorIsSourceMember = sourceMembers.some((m: any) => m.userId === actorUserId)
    if (!actorIsSourceMember) throw { code: 'FORBIDDEN', message: 'actor is not a source room member' }

    const memberIds = new Set<string>()
    if (input.includeActor !== false) memberIds.add(actorUserId)
    for (const item of asList(input.members)) memberIds.add(this.resolveMember(wg.id, item).user_id)

    const agentInputs = asList(input.agents)
    const agentItems: any[] = []
    const seenAgents = new Set<string>()
    if (!agentInputs.length) agentInputs.push(currentAgentId)
    for (const item of agentInputs) {
      const resolved = this.resolveAgent(wg.id, item)
      if (seenAgents.has(resolved.id)) continue
      seenAgents.add(resolved.id)
      const autoRef = input.autoAgent ? normalize(input.autoAgent) : ''
      const itemObj = typeof item === 'object' ? item : {}
      const autoEnabled = itemObj.autoEnabled === true || (!!autoRef && (resolved.id === input.autoAgent || normalize(resolved.name) === autoRef))
      agentItems.push({ agentId: resolved.id, roomRole: autoEnabled ? 'assistant' : 'specialist', autoEnabled, priority: Number(itemObj.priority ?? agentItems.length) })
    }
    if (!seenAgents.has(currentAgentId)) {
      const current = this.resolveAgent(wg.id, currentAgentId)
      agentItems.unshift({ agentId: current.id, roomRole: 'assistant', autoEnabled: !agentItems.some((a) => a.autoEnabled), priority: 0 })
    }

    const creator = db.prepare('SELECT owner_id FROM workgroups WHERE id = ?').get(wg.id) as any
    const room = await roomService.createRoom(name, input.description || input.reason || null, creator?.owner_id || actorUserId, Array.from(memberIds).filter((id) => id !== (creator?.owner_id || actorUserId)), agentItems, {
      skipDefaultAssistant: true,
      roomKind: input.kind || 'service',
      workgroupId: wg.id,
      sourceRoomId,
      syncInitialMembersToWorkgroup: false,
    } as any)
    this.assignRoomToWorkgroup(room.id, wg.id)
    await agentService.refreshRoomAgentContext(room.id).catch(() => {})
    if (input.initialMessage) await messageService.createMessage(room.id, currentAgentId, '工作组会话', 'ai', String(input.initialMessage))
    return { workgroup: wg, room, members: await roomService.getRoomMembers(room.id), agents: await agentService.getRoomAgents(room.id) }
  }
}
