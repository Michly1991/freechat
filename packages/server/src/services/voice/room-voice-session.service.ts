import { v4 as uuidv4 } from 'uuid'
import db from '../../storage/db.js'
import { roomService } from '../room.service.js'

export type RoomVoiceSessionAction = 'started' | 'answered' | 'declined' | 'left' | 'ended' | 'muted'

export class RoomVoiceSessionService {
  private serialize(row: any) {
    if (!row) return null
    const participants = db.prepare(`
      SELECT p.session_id AS sessionId, p.user_id AS userId, p.status, p.muted,
             p.joined_at AS joinedAt, p.left_at AS leftAt,
             COALESCE(u.nickname, u.username, p.user_id) AS name
      FROM room_voice_session_participants p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.session_id = ?
      ORDER BY CASE p.status WHEN 'joined' THEN 0 WHEN 'invited' THEN 1 ELSE 2 END, p.joined_at DESC, p.user_id
    `).all(row.id) as any[]
    return {
      id: row.id,
      roomId: row.room_id,
      createdBy: row.created_by,
      createdByName: row.created_by_name,
      status: row.status,
      providerMode: row.provider_mode,
      createdAt: row.created_at,
      answeredAt: row.answered_at || null,
      endedAt: row.ended_at || null,
      participants: participants.map((p) => ({ ...p, muted: !!p.muted })),
    }
  }

  async getActive(roomId: string, userId: string) {
    await this.ensureMember(roomId, userId)
    const row = db.prepare(`
      SELECT s.*, COALESCE(u.nickname, u.username, s.created_by) AS created_by_name
      FROM room_voice_sessions s
      LEFT JOIN users u ON u.id = s.created_by
      WHERE s.room_id = ? AND s.status IN ('ringing', 'active')
      ORDER BY s.created_at DESC
      LIMIT 1
    `).get(roomId) as any
    return this.serialize(row)
  }

  async start(roomId: string, user: any) {
    await this.ensureMember(roomId, user.id)
    const existing = await this.getActive(roomId, user.id)
    if (existing) return existing
    const now = Date.now()
    const id = `room_voice_${uuidv4()}`
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO room_voice_sessions (id, room_id, created_by, status, provider_mode, created_at)
        VALUES (?, ?, ?, 'ringing', 'byok', ?)
      `).run(id, roomId, user.id, now)
      const members = db.prepare('SELECT user_id FROM room_members WHERE room_id = ?').all(roomId) as any[]
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO room_voice_session_participants
          (session_id, user_id, status, muted, joined_at, left_at)
        VALUES (?, ?, ?, 0, ?, NULL)
      `)
      for (const member of members) stmt.run(id, member.user_id, member.user_id === user.id ? 'joined' : 'invited', member.user_id === user.id ? now : null)
    })
    tx()
    return this.getActive(roomId, user.id)
  }

  async answer(roomId: string, sessionId: string, user: any) {
    await this.ensureMember(roomId, user.id)
    const session = this.getSessionOrThrow(roomId, sessionId)
    if (!['ringing', 'active'].includes(session.status)) throw { code: 'VOICE_SESSION_ENDED', message: '语音对话已结束' }
    const now = Date.now()
    db.transaction(() => {
      db.prepare('UPDATE room_voice_sessions SET status = ?, answered_at = COALESCE(answered_at, ?) WHERE id = ?').run('active', now, sessionId)
      db.prepare(`
        INSERT INTO room_voice_session_participants (session_id, user_id, status, muted, joined_at, left_at)
        VALUES (?, ?, 'joined', 0, ?, NULL)
        ON CONFLICT(session_id, user_id) DO UPDATE SET status = 'joined', joined_at = COALESCE(joined_at, excluded.joined_at), left_at = NULL
      `).run(sessionId, user.id, now)
    })()
    return this.getActive(roomId, user.id)
  }

  async decline(roomId: string, sessionId: string, user: any) {
    await this.ensureMember(roomId, user.id)
    this.getSessionOrThrow(roomId, sessionId)
    db.prepare(`
      INSERT INTO room_voice_session_participants (session_id, user_id, status, muted, joined_at, left_at)
      VALUES (?, ?, 'declined', 0, NULL, ?)
      ON CONFLICT(session_id, user_id) DO UPDATE SET status = 'declined', left_at = excluded.left_at
    `).run(sessionId, user.id, Date.now())
    return this.getActive(roomId, user.id)
  }

  async leave(roomId: string, sessionId: string, user: any) {
    await this.ensureMember(roomId, user.id)
    this.getSessionOrThrow(roomId, sessionId)
    const now = Date.now()
    db.transaction(() => {
      db.prepare(`
        UPDATE room_voice_session_participants SET status = 'left', left_at = ?
        WHERE session_id = ? AND user_id = ?
      `).run(now, sessionId, user.id)
      const joined = db.prepare("SELECT COUNT(*) AS c FROM room_voice_session_participants WHERE session_id = ? AND status = 'joined'").get(sessionId) as any
      if (!joined?.c) db.prepare("UPDATE room_voice_sessions SET status = 'ended', ended_at = ? WHERE id = ? AND status IN ('ringing', 'active')").run(now, sessionId)
    })()
    return this.getById(roomId, sessionId, user.id)
  }

  async updateMe(roomId: string, sessionId: string, user: any, input: any) {
    await this.ensureMember(roomId, user.id)
    this.getSessionOrThrow(roomId, sessionId)
    const muted = input?.muted ? 1 : 0
    db.prepare('UPDATE room_voice_session_participants SET muted = ? WHERE session_id = ? AND user_id = ?').run(muted, sessionId, user.id)
    return this.getActive(roomId, user.id) || this.getById(roomId, sessionId, user.id)
  }

  private getById(roomId: string, sessionId: string, userId: string) {
    const row = db.prepare(`
      SELECT s.*, COALESCE(u.nickname, u.username, s.created_by) AS created_by_name
      FROM room_voice_sessions s
      LEFT JOIN users u ON u.id = s.created_by
      WHERE s.room_id = ? AND s.id = ?
    `).get(roomId, sessionId) as any
    return this.serialize(row)
  }

  private getSessionOrThrow(roomId: string, sessionId: string) {
    const row = db.prepare('SELECT * FROM room_voice_sessions WHERE id = ? AND room_id = ?').get(sessionId, roomId) as any
    if (!row) throw { code: 'VOICE_SESSION_NOT_FOUND', message: '语音对话不存在' }
    return row
  }

  private async ensureMember(roomId: string, userId: string) {
    if (!(await roomService.isMember(roomId, userId))) throw { code: 'NOT_ROOM_MEMBER', message: '你不是该房间成员' }
  }
}

export const roomVoiceSessionService = new RoomVoiceSessionService()
