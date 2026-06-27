import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import { roomService } from './room.service.js'
import { WorkgroupEntryService } from './workgroup-entry.service.js'

export type WorkgroupRole = 'owner' | 'admin' | 'member' | 'viewer'

function now() { return Date.now() }

export class WorkgroupService extends WorkgroupEntryService {
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
    const membership = this.assertUserInWorkgroup(workgroupId, userId)
    return {
      workgroup: {
        ...workgroup,
        current_user_role: membership.role,
        canManage: ['owner', 'admin'].includes(membership.role),
        canViewEntries: true,
      },
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
    let visibility = ''
    if (userId) {
      const membership = db.prepare('SELECT role FROM workgroup_members WHERE workgroup_id = ? AND user_id = ?').get(workgroupId, userId) as any
      const canManage = ['owner', 'admin'].includes(membership?.role)
      if (!canManage) {
        visibility = 'AND (r.created_by = ? OR EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id = r.id AND rm.user_id = ?))'
        params.push(userId, userId)
      }
    }
    return db.prepare(`
      SELECT r.id, r.name, r.description, r.room_kind, r.created_by, r.last_active_at, r.created_at,
        COALESCE(u.nickname, u.username, r.created_by) visitor_name,
        e.title entry_title,
        a.name agent_name
      FROM rooms r
      LEFT JOIN users u ON u.id = r.created_by
      LEFT JOIN workgroup_entries e ON e.id = r.workgroup_entry_id
      LEFT JOIN agents a ON a.id = e.agent_id
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
}

export const workgroupService = new WorkgroupService()
