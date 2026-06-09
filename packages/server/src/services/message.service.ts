import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import type { Message, Mention } from '@freechat/shared'
import { MAX_MESSAGES_PER_ROOM } from '@freechat/shared'
import { roomService } from './room.service.js'

export class MessageService {
  async createMessage(
    roomId: string,
    actorId: string,
    actorName: string,
    actorRole: 'human' | 'ai',
    content: string,
    mentions?: Mention[],
    replyTo?: string,
    kind: string = 'text',
    payload?: any
  ): Promise<Message> {
    const id = `msg_${uuidv4()}`
    const now = Date.now()

    db.prepare(`
      INSERT INTO messages (id, room_id, actor_id, actor_name, actor_role, content, kind, payload, mentions, reply_to, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      roomId,
      actorId,
      actorName,
      actorRole,
      content,
      kind,
      payload ? JSON.stringify(payload) : null,
      mentions ? JSON.stringify(mentions) : null,
      replyTo || null,
      now
    )

    // Update room last active time
    await roomService.updateLastActive(roomId)

    // Cleanup old messages (keep only latest messages)
    this.cleanupOldMessages(roomId)

    return {
      id,
      roomId,
      actorId,
      actorName,
      actorRole,
      content,
      kind: kind as any,
      payload,
      mentions,
      replyTo,
      deleted: false,
      createdAt: now
    }
  }

  async getMessages(roomId: string, limit: number = MAX_MESSAGES_PER_ROOM, before?: string): Promise<Message[]> {
    let query = 'SELECT * FROM messages WHERE room_id = ? AND deleted = 0'
    const params: any[] = [roomId]

    if (before) {
      const beforeMsg: any = db.prepare('SELECT created_at FROM messages WHERE id = ?').get(before)
      if (beforeMsg) {
        query += ' AND created_at < ?'
        params.push(beforeMsg.created_at)
      }
    }

    query += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    const rows: any[] = db.prepare(query).all(...params)

    return rows.reverse().map(row => ({
      id: row.id,
      roomId: row.room_id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      actorRole: row.actor_role,
      content: row.content,
      kind: row.kind || 'text',
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      mentions: row.mentions ? JSON.parse(row.mentions) : undefined,
      replyTo: row.reply_to,
      editedAt: row.edited_at,
      deleted: !!row.deleted,
      createdAt: row.created_at
    }))
  }

  async updateMessage(messageId: string, content: string): Promise<Message> {
    const now = Date.now()
    db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(content, now, messageId)

    const row: any = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId)
    return {
      id: row.id,
      roomId: row.room_id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      actorRole: row.actor_role,
      content: row.content,
      kind: row.kind || 'text',
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      mentions: row.mentions ? JSON.parse(row.mentions) : undefined,
      replyTo: row.reply_to,
      editedAt: row.edited_at,
      deleted: !!row.deleted,
      createdAt: row.created_at
    }
  }

  async deleteMessage(messageId: string): Promise<void> {
    db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(messageId)
  }

  private cleanupOldMessages(roomId: string): void {
    const count: any = db.prepare('SELECT COUNT(*) as count FROM messages WHERE room_id = ? AND deleted = 0').get(roomId)
    
    if (count.count > MAX_MESSAGES_PER_ROOM) {
      const oldest: any[] = db.prepare(`
        SELECT id FROM messages 
        WHERE room_id = ? AND deleted = 0 
        ORDER BY created_at ASC 
        LIMIT ?
      `).all(roomId, count.count - MAX_MESSAGES_PER_ROOM)

      const ids = oldest.map(row => row.id)
      if (ids.length > 0) {
        db.prepare(`UPDATE messages SET deleted = 1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
      }
    }
  }
}

export const messageService = new MessageService()
