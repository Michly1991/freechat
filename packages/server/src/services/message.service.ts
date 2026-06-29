import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import type { Message, Mention, MessageAttachment } from '@freechat/shared'
import { MAX_MESSAGES_PER_ROOM } from '@freechat/shared'
import { roomService } from './room.service.js'
import { conversationMemoryService } from './conversation-memory.service.js'
import { sanitizeAiCompletionForChat } from './inline-tool-markup.js'

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

function interactionRowToPayload(row: any) {
  return {
    id: row.id,
    roomId: row.room_id,
    messageId: row.message_id || undefined,
    createdBy: row.created_by,
    targetUserId: row.target_user_id || undefined,
    type: row.type,
    title: row.title,
    description: row.description || undefined,
    options: parseJson(row.options_json, []),
    status: row.status,
    result: parseJson(row.result_json, undefined),
    payload: parseJson(row.payload_json, undefined),
    priority: row.priority || 'normal',
    responsePolicy: parseJson(row.response_policy, { allowChange: false, allowCancel: true }),
    consumedBy: row.consumed_by || undefined,
    consumedAt: row.consumed_at || undefined,
    expiresAt: row.expires_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedBy: row.resolved_by || undefined,
    resolvedAt: row.resolved_at || undefined,
  }
}

function describeAttachment(file: MessageAttachment): string {
  const parts = [
    `ref=${file.ref || (file.id ? `file:${file.id}` : '')}`,
    `fileId=${file.id || ''}`,
    `name=${file.name || file.relativePath || ''}`,
    `type=${file.mimeType || 'unknown'}`,
    `path=${file.relativePath || ''}`,
  ].filter((part) => !part.endsWith('='))
  return parts.join('; ')
}

export function renderMessageForAgentContext(message: Message): string {
  const role = message.actorRole === 'ai' ? 'AI' : '用户'
  const content = String(message.content || '')
  const attachments = Array.isArray(message.attachments) && message.attachments.length
    ? `\n  附件：${message.attachments.map(describeAttachment).join(' | ')}\n  如需引用“刚才/上面/这个文件”，优先使用这些 file: 引用。`
    : ''
  return `${role} ${message.actorName}: ${content}${attachments}`
}

export class MessageService {
  private rowToMessage(row: any): Message {
    return {
      id: row.id,
      roomId: row.room_id,
      actorId: row.actor_id,
      actorName: row.actor_name,
      actorRole: row.actor_role,
      content: row.content,
      kind: row.kind || 'text',
      payload: row.payload ? JSON.parse(row.payload) : undefined,
      attachments: row.payload && Array.isArray(JSON.parse(row.payload)?.attachments) ? JSON.parse(row.payload).attachments : undefined,
      mentions: row.mentions ? JSON.parse(row.mentions) : undefined,
      replyTo: row.reply_to,
      editedAt: row.edited_at,
      deleted: !!row.deleted,
      createdAt: row.created_at
    }
  }

  private async assertMessageWriteAllowed(messageId: string, roomId: string, user: { id: string; role?: string }, options: { allowAi?: boolean } = {}): Promise<any> {
    const row = db.prepare('SELECT * FROM messages WHERE id = ? AND deleted = 0').get(messageId) as any
    if (!row || row.room_id !== roomId) throw { code: 'MESSAGE_NOT_FOUND', message: 'Message not found in this room' }
    const member = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, user.id) as any
    if (!member) throw { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' }
    const canModerate = ['owner', 'editor'].includes(member.role) || user.role === 'admin'
    const ownsHumanMessage = row.actor_id === user.id && row.actor_role === 'human'
    if (!canModerate && !ownsHumanMessage) throw { code: 'FORBIDDEN', message: 'Only message author or room owner/editor can modify this message' }
    if (!options.allowAi && row.actor_role === 'ai' && !canModerate) throw { code: 'FORBIDDEN', message: 'Only room owner/editor can modify AI messages' }
    return row
  }

  async createMessage(
    roomId: string,
    actorId: string,
    actorName: string,
    actorRole: 'human' | 'ai',
    content: string,
    mentions?: Mention[],
    replyTo?: string,
    kind: string = 'text',
    payload?: any,
    idOverride?: string
  ): Promise<Message> {
    const visibleContent = actorRole === 'ai' && kind === 'text' ? sanitizeAiCompletionForChat(content) : content
    const id = idOverride || `msg_${uuidv4()}`
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
      visibleContent,
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

    if (process.env.DISABLE_CONVERSATION_MEMORY_HOOKS !== '1') {
      void conversationMemoryService.onMessageCreated({ roomId, actorId, actorRole, content: visibleContent, createdAt: now })
        .catch((err) => console.error('[conversation-memory] message hook failed', err))
    }

    return {
      id,
      roomId,
      actorId,
      actorName,
      actorRole,
      content: visibleContent,
      kind: kind as any,
      payload,
      attachments: Array.isArray(payload?.attachments) ? payload.attachments as MessageAttachment[] : undefined,
      mentions,
      replyTo,
      deleted: false,
      createdAt: now
    }
  }

  async getMessagesPage(roomId: string, limit: number = MAX_MESSAGES_PER_ROOM, before?: string): Promise<{ messages: Message[]; hasMore: boolean }> {
    const pageLimit = Math.max(1, limit)
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
    params.push(pageLimit + 1)

    const rows: any[] = db.prepare(query).all(...params)
    const hasMore = rows.length > pageLimit
    const pageRows = rows.slice(0, pageLimit)

    const messages = pageRows.reverse().map(row => {
      let payload = row.payload ? JSON.parse(row.payload) : undefined
      if ((row.kind || 'text') === 'interaction_request') {
        const interactionId = payload?.interactionId || payload?.interaction?.id
        const interaction = db.prepare('SELECT * FROM interaction_requests WHERE message_id = ? OR id = ?').get(row.id, interactionId || '') as any
        if (interaction) payload = { ...(payload || {}), interactionId: interaction.id, interaction: interactionRowToPayload(interaction) }
      }
      return {
        id: row.id,
        roomId: row.room_id,
        actorId: row.actor_id,
        actorName: row.actor_name,
        actorRole: row.actor_role,
        content: row.content,
        kind: row.kind || 'text',
        payload,
        attachments: Array.isArray(payload?.attachments) ? payload.attachments : undefined,
        mentions: row.mentions ? JSON.parse(row.mentions) : undefined,
        replyTo: row.reply_to,
        editedAt: row.edited_at,
        deleted: !!row.deleted,
        createdAt: row.created_at
      }
    })
    return { messages, hasMore }
  }

  async getMessages(roomId: string, limit: number = MAX_MESSAGES_PER_ROOM, before?: string): Promise<Message[]> {
    return (await this.getMessagesPage(roomId, limit, before)).messages
  }

  async updateMessage(messageId: string, content: string): Promise<Message> {
    const now = Date.now()
    db.prepare('UPDATE messages SET content = ?, edited_at = ? WHERE id = ?').run(content, now, messageId)

    const row: any = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId)
    return this.rowToMessage(row)
  }

  async updateMessageAsUser(messageId: string, roomId: string, user: { id: string; role?: string }, content: string): Promise<Message> {
    await this.assertMessageWriteAllowed(messageId, roomId, user)
    return this.updateMessage(messageId, content)
  }

  async deleteMessage(messageId: string): Promise<void> {
    db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(messageId)
  }

  async deleteMessageAsUser(messageId: string, roomId: string, user: { id: string; role?: string }): Promise<void> {
    await this.assertMessageWriteAllowed(messageId, roomId, user, { allowAi: true })
    await this.deleteMessage(messageId)
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
