import db from '../storage/db.js'
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
