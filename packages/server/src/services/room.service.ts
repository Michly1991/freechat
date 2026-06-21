import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import type { Room, RoomMember, RoomAgentRole } from '@freechat/shared'
import { agentPackageService } from './agent-package.service.js'

interface InitialRoomAgent {
  agentId: string
  roomRole?: RoomAgentRole
  autoEnabled?: boolean
  priority?: number
}

function getUserIdentityType(userId: string): 'human' | 'agent' {
  const row = db.prepare('SELECT identity_type FROM users WHERE id = ?').get(userId) as any
  return row?.identity_type === 'agent' ? 'agent' : 'human'
}

export class RoomService {
  async createRoom(name: string, description: string | null, userId: string, initialMemberIds: string[] = [], initialAgents: InitialRoomAgent[] = [], options: { skipDefaultAssistant?: boolean; roomKind?: string; directKey?: string; directTargetType?: string; directTargetId?: string } = {}): Promise<Room> {
    const id = `room_${uuidv4()}`
    const now = Date.now()

    const ownedAgents = initialAgents
      .map((agent, index) => ({
        agentId: String(agent.agentId || ''),
        roomRole: agent.roomRole === 'assistant' ? 'assistant' : 'specialist' as RoomAgentRole,
        autoEnabled: agent.autoEnabled === true,
        priority: Number(agent.priority ?? index + 1),
      }))
      .filter((agent) => agent.agentId)
      .filter((agent, index, arr) => arr.findIndex((item) => item.agentId === agent.agentId) === index)
      .filter((agent) => {
        const row = db.prepare('SELECT owner_id FROM agents WHERE id = ? AND status != ?').get(agent.agentId, 'inactive') as any
        return row?.owner_id === userId
      })
    let autoSeen = false
    for (const agent of ownedAgents) {
      if (agent.autoEnabled && !autoSeen) {
        autoSeen = true
        agent.roomRole = 'assistant'
      } else {
        agent.autoEnabled = false
      }
    }
    const create = db.transaction(() => {
      db.prepare(`
        INSERT INTO rooms (id, name, description, created_by, created_at, updated_at, last_active_at, room_kind, direct_key, direct_target_type, direct_target_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, description, userId, now, now, now, options.roomKind || 'project', options.directKey || null, options.directTargetType || null, options.directTargetId || null)

      // Add creator as owner
      db.prepare(`
        INSERT INTO room_members (room_id, user_id, role, type, joined_at)
        VALUES (?, ?, 'owner', ?, ?)
      `).run(id, userId, getUserIdentityType(userId), now)

      for (const memberId of initialMemberIds) {
        db.prepare(`
          INSERT OR IGNORE INTO room_members (room_id, user_id, role, type, joined_at)
          VALUES (?, ?, 'editor', ?, ?)
        `).run(id, memberId, getUserIdentityType(memberId), now)
      }


      for (const agent of ownedAgents) {
        db.prepare(`
          INSERT OR REPLACE INTO room_agents (room_id, agent_id, added_by, added_at, room_role, auto_enabled, priority)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, agent.agentId, userId, now, agent.roomRole, agent.autoEnabled ? 1 : 0, agent.priority)
      }
    })

    create()

    await agentPackageService.ensureRoomWorkspace(id, { id, name, description, created_by: userId })

    return this.getRoom(id)
  }

  async getRoom(roomId: string): Promise<Room> {
    const row: any = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId)
    if (!row) {
      throw { code: 'ROOM_NOT_FOUND', message: 'Room not found' }
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActiveAt: row.last_active_at,
      roomKind: row.room_kind || 'project',
      directKey: row.direct_key || undefined,
      directTargetType: row.direct_target_type || undefined,
      directTargetId: row.direct_target_id || undefined,
      assistantMode: row.assistant_mode || 'fixed',
      currentAssistantAgentId: row.current_assistant_agent_id || undefined,
      assistantHandoffAt: row.assistant_handoff_at || undefined,
      assistantHandoffBy: row.assistant_handoff_by || undefined,
      assistantHandoffReason: row.assistant_handoff_reason || undefined,
    } as any
  }

  async getUserRooms(userId: string): Promise<Room[]> {
    const rows: any[] = db.prepare(`
      SELECT r.*, rm.role as member_role FROM rooms r
      INNER JOIN room_members rm ON r.id = rm.room_id
      WHERE rm.user_id = ? AND r.deleted_at IS NULL
      ORDER BY r.last_active_at DESC
    `).all(userId)

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActiveAt: row.last_active_at,
      roomKind: row.room_kind || 'project',
      directKey: row.direct_key || undefined,
      directTargetType: row.direct_target_type || undefined,
      directTargetId: row.direct_target_id || undefined,
      currentAssistantAgentId: row.current_assistant_agent_id || undefined,
      memberRole: row.member_role,
      canDelete: row.member_role === 'owner'
    } as any))
  }

  async handoffAssistant(roomId: string, agentId: string, by: string, reason?: string): Promise<Room> {
    const exists = db.prepare('SELECT 1 FROM room_agents ra JOIN agents a ON a.id = ra.agent_id WHERE ra.room_id = ? AND ra.agent_id = ? AND a.status != ?').get(roomId, agentId, 'inactive')
    if (!exists) throw { code: 'AGENT_NOT_IN_ROOM', message: 'Agent is not active in this room' }
    const now = Date.now()
    db.transaction(() => {
      db.prepare("UPDATE room_agents SET auto_enabled = 0, room_role = 'specialist' WHERE room_id = ?").run(roomId)
      db.prepare("UPDATE room_agents SET auto_enabled = 1, room_role = 'assistant' WHERE room_id = ? AND agent_id = ?").run(roomId, agentId)
      db.prepare("UPDATE rooms SET assistant_mode = 'handoff', current_assistant_agent_id = ?, assistant_handoff_at = ?, assistant_handoff_by = ?, assistant_handoff_reason = ?, updated_at = ? WHERE id = ?").run(agentId, now, by, reason || null, now, roomId)
    })()
    return this.getRoom(roomId)
  }

  async updateRoom(roomId: string, name?: string, description?: string): Promise<Room> {
    const updates: string[] = []
    const values: any[] = []

    if (name !== undefined) {
      updates.push('name = ?')
      values.push(name)
    }
    if (description !== undefined) {
      updates.push('description = ?')
      values.push(description)
    }

    if (updates.length === 0) {
      return this.getRoom(roomId)
    }

    updates.push('updated_at = ?')
    values.push(Date.now())
    values.push(roomId)

    db.prepare(`UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`).run(...values)
    return this.getRoom(roomId)
  }

  async deleteRoom(roomId: string, userId?: string): Promise<void> {
    const room: any = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId)
    if (!room) {
      throw { code: 'ROOM_NOT_FOUND', message: 'Room not found' }
    }

    const member: any = userId
      ? db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId)
      : null

    if (userId && member?.role !== 'owner') {
      throw { code: 'FORBIDDEN', message: '你没有权限删除该项目' }
    }

    const now = Date.now()
    db.prepare('UPDATE rooms SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(now, userId || null, now, roomId)
  }

  async getRoomMembers(roomId: string): Promise<RoomMember[]> {
    const rows: any[] = db.prepare(`
      SELECT rm.*, u.username, u.nickname, u.avatar, u.identity_type
      FROM room_members rm
      INNER JOIN users u ON rm.user_id = u.id
      WHERE rm.room_id = ?
    `).all(roomId)

    return rows.map(row => ({
      userId: row.user_id,
      username: row.username,
      nickname: row.nickname,
      avatar: row.avatar,
      role: row.role,
      type: row.type || row.identity_type || 'human',
      identityType: row.identity_type || row.type || 'human',
      joinedAt: row.joined_at
    }))
  }

  async addMember(roomId: string, userId: string, role: string = 'editor'): Promise<void> {
    const now = Date.now()
    db.prepare(`
      INSERT OR REPLACE INTO room_members (room_id, user_id, role, type, joined_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(roomId, userId, role, getUserIdentityType(userId), now)
  }

  async removeMember(roomId: string, userId: string): Promise<void> {
    db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(roomId, userId)
  }

  async isMember(roomId: string, userId: string): Promise<boolean> {
    const row = db.prepare('SELECT 1 FROM room_members rm INNER JOIN rooms r ON r.id = rm.room_id WHERE rm.room_id = ? AND rm.user_id = ? AND r.deleted_at IS NULL').get(roomId, userId)
    return !!row
  }

  async updateLastActive(roomId: string): Promise<void> {
    db.prepare('UPDATE rooms SET last_active_at = ? WHERE id = ? AND deleted_at IS NULL').run(Date.now(), roomId)
  }
}

export const roomService = new RoomService()
