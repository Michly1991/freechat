import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { config } from '../config.js'
import type { Room, RoomMember } from '@freechat/shared'

export class RoomService {
  async createRoom(name: string, description: string | null, userId: string, initialMemberIds: string[] = []): Promise<Room> {
    const id = `room_${uuidv4()}`
    const assistantAgentId = `agent_${uuidv4()}`
    const now = Date.now()
    const apiKey = `fc_${crypto.randomBytes(32).toString('hex')}`
    const apiKeyHash = await bcrypt.hash(apiKey, 10)

    const create = db.transaction(() => {
      db.prepare(`
        INSERT INTO rooms (id, name, description, created_by, created_at, updated_at, last_active_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, description, userId, now, now, now)

      // Add creator as owner
      db.prepare(`
        INSERT INTO room_members (room_id, user_id, role, joined_at)
        VALUES (?, ?, 'owner', ?)
      `).run(id, userId, now)

      for (const memberId of initialMemberIds) {
        db.prepare(`
          INSERT OR IGNORE INTO room_members (room_id, user_id, role, joined_at)
          VALUES (?, ?, 'editor', ?)
        `).run(id, memberId, now)
      }

      // Create a default assistant agent for every room.
      db.prepare(`
        INSERT INTO agents (id, owner_id, name, role_type, deployment, description, specialties, config, api_key_hash, status, created_at, updated_at)
        VALUES (?, ?, ?, 'assistant', 'server', ?, ?, ?, ?, 'active', ?, ?)
      `).run(
        assistantAgentId,
        userId,
        '助理',
        '默认房间助理，可以参与讨论、总结信息、协调专家 Agent，并在需要时做最终决策。',
        JSON.stringify(['协作', '总结', '任务协调', '决策']),
        JSON.stringify({ defaultRoomAssistant: true, roomId: id }),
        apiKeyHash,
        now,
        now
      )

      db.prepare(`
        INSERT INTO room_agents (room_id, agent_id, added_by, added_at)
        VALUES (?, ?, ?, ?)
      `).run(id, assistantAgentId, userId, now)
    })

    create()

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
      lastActiveAt: row.last_active_at
    }
  }

  async getUserRooms(userId: string): Promise<Room[]> {
    const rows: any[] = db.prepare(`
      SELECT r.* FROM rooms r
      INNER JOIN room_members rm ON r.id = rm.room_id
      WHERE rm.user_id = ?
      ORDER BY r.last_active_at DESC
    `).all(userId)

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActiveAt: row.last_active_at
    }))
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
      throw { code: 'FORBIDDEN', message: 'Only room owner can delete this project' }
    }

    const defaultAssistantRows: any[] = db.prepare(`
      SELECT a.id FROM agents a
      INNER JOIN room_agents ra ON a.id = ra.agent_id
      WHERE ra.room_id = ?
        AND a.role_type = 'assistant'
        AND a.config LIKE ?
    `).all(roomId, `%"defaultRoomAssistant":true%`)

    const hardDelete = db.transaction(() => {
      // Delete room first. Foreign keys cascade room_members/messages/tasks/tabs/room_agents/profiles/sessions/invites.
      db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId)

      // Remove only the auto-created default assistant for this room.
      // Manually added reusable agents are kept.
      for (const row of defaultAssistantRows) {
        db.prepare('DELETE FROM agents WHERE id = ?').run(row.id)
      }
    })

    hardDelete()

    // Remove room workspace files after DB delete. Missing directories are fine.
    await rm(join(config.workspace.root, roomId), { recursive: true, force: true })
  }

  async getRoomMembers(roomId: string): Promise<RoomMember[]> {
    const rows: any[] = db.prepare(`
      SELECT rm.*, u.username, u.nickname, u.avatar
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
      type: row.type || 'human',
      joinedAt: row.joined_at
    }))
  }

  async addMember(roomId: string, userId: string, role: string = 'editor'): Promise<void> {
    const now = Date.now()
    db.prepare(`
      INSERT OR REPLACE INTO room_members (room_id, user_id, role, joined_at)
      VALUES (?, ?, ?, ?)
    `).run(roomId, userId, role, now)
  }

  async removeMember(roomId: string, userId: string): Promise<void> {
    db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(roomId, userId)
  }

  async isMember(roomId: string, userId: string): Promise<boolean> {
    const row = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId)
    return !!row
  }

  async updateLastActive(roomId: string): Promise<void> {
    db.prepare('UPDATE rooms SET last_active_at = ? WHERE id = ?').run(Date.now(), roomId)
  }
}

export const roomService = new RoomService()
