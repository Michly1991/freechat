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
function publicEntry(row: any, token?: string) { return row ? { id: row.id, workgroupId: row.workgroup_id, agentId: row.agent_id, agentName: row.agent_name, title: row.title, description: row.description, accessMode: row.access_mode, enabled: !!row.enabled, welcomeMessage: row.welcome_message, maxUses: row.max_uses, usedCount: row.used_count || 0, expiresAt: row.expires_at, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, token: token || row.token } : null }

export class WorkgroupService {
  createWorkgroup(userId: string, input: { name: string; description?: string }) {
    const name = String(input.name || '').trim()
    if (!name) throw { code: 'VALIDATION_ERROR', message: 'name is required' }
    const id = `wg_${uuidv4()}`
    const ts = now()
    db.transaction(() => {
      db.prepare('INSERT INTO workgroups (id, name, description, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, name, input.description || null, userId, ts, ts)
      db.prepare('INSERT INTO workgroup_members (workgroup_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
        .run(id, userId, 'owner', ts)
    })()
    return this.getOverview(id, userId)
  }

  listForUser(userId: string) {
    this.ensureDefaultWorkgroup(userId)
    const rows = db.prepare(`
      SELECT wg.*, wm.role current_user_role,
        (SELECT COUNT(*) FROM workgroup_members WHERE workgroup_id = wg.id) member_count,
        (SELECT COUNT(*) FROM workgroup_agents WHERE workgroup_id = wg.id AND enabled = 1) agent_count,
        (SELECT COUNT(*) FROM rooms WHERE workgroup_id = wg.id AND deleted_at IS NULL) room_count
      FROM workgroups wg
      JOIN workgroup_members wm ON wm.workgroup_id = wg.id
      WHERE wm.user_id = ?
      ORDER BY wg.updated_at DESC, wg.created_at DESC
    `).all(userId) as any[]
    return rows.map((row) => ({ ...row, canManage: ['owner', 'admin'].includes(row.current_user_role) }))
  }

  getOverview(workgroupId: string, userId: string) {
    const workgroup = this.getWorkgroup(workgroupId)
    this.assertUserInWorkgroup(workgroupId, userId)
    return {
      workgroup,
      members: this.listMembers(workgroupId),
      agents: this.listAgents(workgroupId),
      rooms: this.listRooms(workgroupId, userId),
    }
  }

  updateWorkgroup(workgroupId: string, userId: string, input: { name?: string; description?: string }) {
    this.assertCanManage(workgroupId, userId)
    const updates: string[] = []
    const values: any[] = []
    if (input.name !== undefined) { updates.push('name = ?'); values.push(String(input.name).trim()) }
    if (input.description !== undefined) { updates.push('description = ?'); values.push(input.description || null) }
    if (!updates.length) return this.getOverview(workgroupId, userId)
    updates.push('updated_at = ?'); values.push(now(), workgroupId)
    db.prepare(`UPDATE workgroups SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    return this.getOverview(workgroupId, userId)
  }

  ensureDefaultWorkgroup(userId: string) {
    const existing = db.prepare('SELECT wg.* FROM workgroups wg JOIN workgroup_members wm ON wm.workgroup_id = wg.id WHERE wm.user_id = ? ORDER BY wg.created_at LIMIT 1').get(userId) as any
    if (existing) return existing
    const user = db.prepare('SELECT username, nickname FROM users WHERE id = ?').get(userId) as any
    const id = `wg_${uuidv4()}`
    const ts = now()
    db.transaction(() => {
      db.prepare('INSERT INTO workgroups (id, name, description, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, `${user?.nickname || user?.username || '我的'}的工作组`, '默认工作组', userId, ts, ts)
      db.prepare('INSERT INTO workgroup_members (workgroup_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
        .run(id, userId, 'owner', ts)
    })()
    return db.prepare('SELECT * FROM workgroups WHERE id = ?').get(id) as any
  }

  ensureRoomWorkgroup(roomId: string) {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as any
    if (!room) throw { code: 'ROOM_NOT_FOUND', message: 'Room not found' }
    if (room.workgroup_id) return this.getWorkgroup(room.workgroup_id)
    const wg = this.ensureDefaultWorkgroup(room.created_by)
    db.prepare('UPDATE rooms SET workgroup_id = ? WHERE id = ?').run(wg.id, roomId)
    this.syncRoomParticipantsToWorkgroup(roomId, wg.id)
    return wg
  }

  assignRoomToWorkgroup(roomId: string, workgroupId: string) {
    db.prepare('UPDATE rooms SET workgroup_id = ? WHERE id = ?').run(workgroupId, roomId)
    this.syncRoomParticipantsToWorkgroup(roomId, workgroupId)
  }

  syncRoomParticipantsToWorkgroup(roomId: string, workgroupId: string) {
    const ts = now()
    const room = db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(roomId) as any
    if (room?.created_by) db.prepare('INSERT OR IGNORE INTO workgroup_members (workgroup_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(workgroupId, room.created_by, 'owner', ts)
    const members = db.prepare('SELECT user_id, role FROM room_members WHERE room_id = ?').all(roomId) as any[]
    for (const member of members) {
      const role = member.role === 'owner' ? 'admin' : 'member'
      db.prepare('INSERT OR IGNORE INTO workgroup_members (workgroup_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(workgroupId, member.user_id, role, ts)
    }
    const agents = db.prepare('SELECT agent_id FROM room_agents WHERE room_id = ?').all(roomId) as any[]
    for (const agent of agents) {
      db.prepare('INSERT OR IGNORE INTO workgroup_agents (workgroup_id, agent_id, role, enabled, added_at) VALUES (?, ?, ?, 1, ?)').run(workgroupId, agent.agent_id, 'member', ts)
    }
  }

  getWorkgroup(workgroupId: string) {
    const row = db.prepare('SELECT * FROM workgroups WHERE id = ?').get(workgroupId) as any
    if (!row) throw { code: 'WORKGROUP_NOT_FOUND', message: 'Workgroup not found' }
    return row
  }

  getRoomWorkgroup(roomId: string) {
    return this.ensureRoomWorkgroup(roomId)
  }

  listMembers(workgroupId: string) {
    return db.prepare(`
      SELECT wm.workgroup_id, wm.user_id, wm.role, wm.joined_at, u.username, u.nickname, u.avatar, u.identity_type
      FROM workgroup_members wm
      JOIN users u ON u.id = wm.user_id
      WHERE wm.workgroup_id = ?
      ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.nickname, u.username
    `).all(workgroupId) as any[]
  }

  listAgents(workgroupId: string) {
    return db.prepare(`
      SELECT wa.workgroup_id, wa.agent_id, wa.role as workgroup_role, wa.enabled, wa.added_at,
        a.id, a.name, a.description, a.specialties, a.status, a.owner_id, a.deployment
      FROM workgroup_agents wa
      JOIN agents a ON a.id = wa.agent_id
      WHERE wa.workgroup_id = ? AND wa.enabled = 1 AND a.status != 'inactive'
      ORDER BY a.name
    `).all(workgroupId).map((row: any) => ({
      ...row,
      specialties: row.specialties ? JSON.parse(row.specialties) : [],
    }))
  }

  listRooms(workgroupId: string, userId?: string) {
    const params: any[] = [workgroupId]
    const visibility = userId ? 'AND (r.created_by = ? OR EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id = r.id AND rm.user_id = ?))' : ''
    if (userId) params.push(userId, userId)
    return db.prepare(`
      SELECT r.id, r.name, r.description, r.room_kind, r.created_by, r.last_active_at, r.created_at
      FROM rooms r
      WHERE r.workgroup_id = ? AND r.deleted_at IS NULL ${visibility}
      ORDER BY r.last_active_at DESC
      LIMIT 100
    `).all(...params) as any[]
  }

  assertUserInWorkgroup(workgroupId: string, userId: string) {
    const row = db.prepare('SELECT role FROM workgroup_members WHERE workgroup_id = ? AND user_id = ?').get(workgroupId, userId) as any
    if (!row) throw { code: 'WORKGROUP_FORBIDDEN', message: 'User is not in this workgroup' }
    return row
  }

  assertCanManage(workgroupId: string, userId: string) {
    const row = this.assertUserInWorkgroup(workgroupId, userId)
    if (!['owner', 'admin'].includes(row.role)) throw { code: 'WORKGROUP_FORBIDDEN', message: 'Only workgroup owner/admin can manage this workgroup' }
    return row
  }

  addMember(workgroupId: string, userId: string, role: WorkgroupRole = 'member') {
    this.getWorkgroup(workgroupId)
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as any
    if (!user) throw { code: 'USER_NOT_FOUND', message: 'User not found' }
    db.prepare('INSERT OR REPLACE INTO workgroup_members (workgroup_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)')
      .run(workgroupId, userId, role, now())
  }

  addAgent(workgroupId: string, agentId: string, role = 'member') {
    this.getWorkgroup(workgroupId)
    const agent = db.prepare('SELECT id FROM agents WHERE id = ? AND status != ?').get(agentId, 'inactive') as any
    if (!agent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    db.prepare('INSERT OR REPLACE INTO workgroup_agents (workgroup_id, agent_id, role, enabled, added_at) VALUES (?, ?, ?, 1, ?)')
      .run(workgroupId, agentId, role, now())
  }

  listAvailableAgents(workgroupId: string, userId: string) {
    this.assertCanManage(workgroupId, userId)
    const rows = db.prepare(`
      SELECT a.*, COALESCE(u.nickname, u.username) owner_name
      FROM agents a
      LEFT JOIN users u ON u.id = a.owner_id
      WHERE a.status != 'inactive'
        AND COALESCE(a.is_template, 1) = 1
        AND (a.owner_id = ? OR COALESCE(a.market_listed, 0) = 1 OR EXISTS (SELECT 1 FROM market_follows mf WHERE mf.user_id = ? AND mf.target_type = 'agent' AND mf.target_id = a.id))
        AND NOT EXISTS (SELECT 1 FROM workgroup_agents wa WHERE wa.workgroup_id = ? AND wa.agent_id = a.id AND wa.enabled = 1)
      ORDER BY a.owner_id = ? DESC, a.name ASC
    `).all(userId, userId, workgroupId, userId) as any[]
    return rows.map((row) => ({ ...row, ownerName: row.owner_name, specialties: row.specialties ? JSON.parse(row.specialties) : [] }))
  }

  updateAgent(workgroupId: string, agentId: string, input: { role?: string; enabled?: boolean }) {
    this.getWorkgroup(workgroupId)
    const row = db.prepare('SELECT 1 FROM workgroup_agents WHERE workgroup_id = ? AND agent_id = ?').get(workgroupId, agentId)
    if (!row) throw { code: 'AGENT_NOT_FOUND', message: 'Workgroup Agent not found' }
    const role = input.role ? String(input.role) : undefined
    const enabled = input.enabled === undefined ? undefined : (input.enabled ? 1 : 0)
    if (role !== undefined && enabled !== undefined) db.prepare('UPDATE workgroup_agents SET role = ?, enabled = ? WHERE workgroup_id = ? AND agent_id = ?').run(role, enabled, workgroupId, agentId)
    else if (role !== undefined) db.prepare('UPDATE workgroup_agents SET role = ? WHERE workgroup_id = ? AND agent_id = ?').run(role, workgroupId, agentId)
    else if (enabled !== undefined) db.prepare('UPDATE workgroup_agents SET enabled = ? WHERE workgroup_id = ? AND agent_id = ?').run(enabled, workgroupId, agentId)
  }

  removeAgent(workgroupId: string, agentId: string) {
    db.prepare('DELETE FROM workgroup_agents WHERE workgroup_id = ? AND agent_id = ?').run(workgroupId, agentId)
  }

  updateMember(workgroupId: string, userId: string, role: WorkgroupRole) {
    this.getWorkgroup(workgroupId)
    const row = db.prepare('SELECT role FROM workgroup_members WHERE workgroup_id = ? AND user_id = ?').get(workgroupId, userId) as any
    if (!row) throw { code: 'USER_NOT_FOUND', message: 'Workgroup member not found' }
    if (row.role === 'owner' && role !== 'owner') this.assertHasOtherOwner(workgroupId, userId)
    db.prepare('UPDATE workgroup_members SET role = ? WHERE workgroup_id = ? AND user_id = ?').run(role, workgroupId, userId)
  }

  removeMember(workgroupId: string, userId: string) {
    const row = db.prepare('SELECT role FROM workgroup_members WHERE workgroup_id = ? AND user_id = ?').get(workgroupId, userId) as any
    if (!row) throw { code: 'USER_NOT_FOUND', message: 'Workgroup member not found' }
    if (row.role === 'owner') this.assertHasOtherOwner(workgroupId, userId)
    db.prepare('DELETE FROM workgroup_members WHERE workgroup_id = ? AND user_id = ?').run(workgroupId, userId)
  }

  private assertHasOtherOwner(workgroupId: string, userId: string) {
    const other = db.prepare("SELECT 1 FROM workgroup_members WHERE workgroup_id = ? AND role = 'owner' AND user_id != ? LIMIT 1").get(workgroupId, userId)
    if (!other) throw { code: 'VALIDATION_ERROR', message: '不能移除或降级最后一个 owner' }
  }

  listEntries(workgroupId: string) {
    return (db.prepare(`
      SELECT e.*, a.name agent_name
      FROM workgroup_entries e
      JOIN agents a ON a.id = e.agent_id
      WHERE e.workgroup_id = ?
      ORDER BY e.created_at DESC
    `).all(workgroupId) as any[]).map((row) => publicEntry(row))
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
    return publicEntry(row, token)
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

  getEntryByToken(token: string) {
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
    return { ...publicEntry(row), workgroupName: row.workgroup_name, workgroupDescription: row.workgroup_description, agentDescription: row.agent_description }
  }

  async joinEntry(token: string, userId: string) {
    const entry = this.getEntryByToken(token) as any
    const account = db.prepare('SELECT balance FROM credit_accounts WHERE user_id = ?').get(userId) as any
    if (!account || account.balance <= 0) throw { code: 'INSUFFICIENT_CREDITS', message: '余额不足，不能创建分享入口会话。请先充值 credit。' }
    db.prepare('INSERT OR IGNORE INTO workgroup_members (workgroup_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(entry.workgroupId, userId, 'member', now())
    const room = await roomService.createRoom(entry.title, entry.description || null, userId, [], [{ agentId: entry.agentId, roomRole: 'assistant', autoEnabled: true, priority: 0 }], { roomKind: 'entry', workgroupId: entry.workgroupId, workgroupEntryId: entry.id, syncInitialMembersToWorkgroup: false })
    db.prepare('UPDATE workgroup_entries SET used_count = COALESCE(used_count, 0) + 1, updated_at = ? WHERE id = ?').run(now(), entry.id)
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

export const workgroupService = new WorkgroupService()
