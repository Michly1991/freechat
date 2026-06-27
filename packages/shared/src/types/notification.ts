// === Notification Types ===
export type NotificationType = 'mention' | 'task_assigned' | 'task_updated' | 'agent_done' | 'file_changed'

export interface AppNotification {
  id: string
  userId: string
  roomId?: string
  messageId?: string
  taskId?: string
  type: NotificationType
  title: string
  body?: string
  actorId?: string
  actorName?: string
  readAt?: number
  createdAt: number
  targetPath?: string
}
