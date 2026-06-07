import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import type { Room, RoomMember } from '@freechat/shared'

export class RoomService {
  async createRoom(name: string, description: string | null, userId: string): Promise<Room> {
    const id = `room_${uuidv4()}`
    const now = Date.now()

    db.prepare(`
      INSERT INTO rooms (id, name, description, created_by, created_at, updated_at, last_active_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description, userId, now, now, now)

    // Add creator as owner
    db.prepare(`
      INSERT INTO room_members (room_id, user_id, role, joined_at)
      VALUES (?, ?, 'owner', ?)
    `).run(id, userId, now)

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

  async deleteRoom(roomId: string): Promise<void> {
    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId)
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
