import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import { getGateway } from '../ws/gateway.js'

export type NotificationType = 'mention' | 'task_assigned' | 'task_updated' | 'agent_done' | 'file_changed'

export interface CreateNotificationInput {
  userId: string
  roomId?: string
  messageId?: string
  taskId?: string
  type: NotificationType
  title: string
  body?: string
  actorId?: string
  actorName?: string
}

function mapRow(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    roomId: row.room_id || undefined,
    messageId: row.message_id || undefined,
    taskId: row.task_id || undefined,
    type: row.type,
    title: row.title,
    body: row.body || undefined,
    actorId: row.actor_id || undefined,
    actorName: row.actor_name || undefined,
    readAt: row.read_at || undefined,
    createdAt: row.created_at,
    targetPath: row.room_id ? `/room/${row.room_id}` : undefined,
  }
}

export class NotificationService {
  create(input: CreateNotificationInput) {
    if (!input.userId) return null
    const id = `ntf_${uuidv4()}`
    const now = Date.now()
    db.prepare(`
      INSERT INTO notifications (id, user_id, room_id, message_id, task_id, type, title, body, actor_id, actor_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.userId,
      input.roomId || null,
      input.messageId || null,
      input.taskId || null,
      input.type,
      input.title,
      input.body || null,
      input.actorId || null,
      input.actorName || null,
      now
    )
    const notification = this.get(id)
    getGateway()?.sendToUser(input.userId, {
      msgId: id,
      roomId: input.roomId || '',
      type: 'broadcast',
      action: 'notification.created',
      payload: { notification },
      timestamp: now,
    })
    return notification
  }

  notifyMentions(args: { roomId: string; messageId: string; actorId: string; actorName: string; content: string; mentions?: any[] }) {
    const humanIds = Array.from(new Set((args.mentions || []).filter((m) => (m.role === 'human' || m.type === 'user') && m.id && m.id !== args.actorId).map((m) => String(m.id))))
    for (const userId of humanIds) {
      const member = db.prepare('SELECT user_id FROM room_members WHERE room_id = ? AND user_id = ? AND type = ?').get(args.roomId, userId, 'human') as any
      if (!member) continue
      this.create({
        userId,
        roomId: args.roomId,
        messageId: args.messageId,
        type: 'mention',
        title: `${args.actorName} 提到了你`,
        body: args.content.slice(0, 160),
        actorId: args.actorId,
        actorName: args.actorName,
      })
    }
  }

  notifyTaskAssigned(args: { roomId: string; taskId: string; title: string; assigneeId?: string; assigneeType?: string; actorId?: string; actorName?: string; isSubtask?: boolean }) {
    if (!args.assigneeId || args.assigneeType !== 'human' || args.assigneeId === args.actorId) return
    const member = db.prepare('SELECT user_id FROM room_members WHERE room_id = ? AND user_id = ? AND type = ?').get(args.roomId, args.assigneeId, 'human') as any
    if (!member) return
    this.create({
      userId: args.assigneeId,
      roomId: args.roomId,
      taskId: args.taskId,
      type: 'task_assigned',
      title: args.isSubtask ? '有新的子任务分派给你' : '有新的任务分派给你',
      body: args.title,
      actorId: args.actorId,
      actorName: args.actorName,
    })
  }

  notifyTaskDone(args: { roomId: string; taskId: string; title: string; createdBy?: string; actorId?: string; actorName?: string; status?: string }) {
    if (!args.createdBy || args.createdBy === args.actorId) return
    if (args.status !== 'done' && args.status !== 'review') return
    this.create({
      userId: args.createdBy,
      roomId: args.roomId,
      taskId: args.taskId,
      type: 'agent_done',
      title: args.status === 'review' ? '任务已提交审核' : '任务已完成',
      body: args.title,
      actorId: args.actorId,
      actorName: args.actorName,
    })
  }

  get(id: string) {
    const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(id) as any
    return row ? mapRow(row) : null
  }

  list(userId: string, limit = 30, unreadOnly = false) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100))
    const rows = db.prepare(`
      SELECT * FROM notifications
      WHERE user_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(userId, safeLimit) as any[]
    const unread = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as any
    return { notifications: rows.map(mapRow), unreadCount: unread?.count || 0 }
  }

  markRead(userId: string, ids: string[]) {
    const cleanIds = Array.from(new Set(ids.filter(Boolean)))
    if (cleanIds.length === 0) return this.list(userId)
    db.prepare(`
      UPDATE notifications SET read_at = ?
      WHERE user_id = ? AND id IN (${cleanIds.map(() => '?').join(',')})
    `).run(Date.now(), userId, ...cleanIds)
    return this.list(userId)
  }

  markAllRead(userId: string) {
    db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(Date.now(), userId)
    return this.list(userId)
  }
}

export const notificationService = new NotificationService()
