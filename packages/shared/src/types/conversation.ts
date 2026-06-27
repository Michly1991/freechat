import type { Message } from './message.js'
import type { RoomMember } from './room.js'

// === Conversation Types ===
export type ConversationType = 'dm' | 'project'

export interface ConversationSummary {
  type: ConversationType
  id: string
  title: string
  subtitle?: string
  avatar?: string
  targetPath: string
  lastMessage?: Pick<Message, 'id' | 'actorName' | 'content' | 'createdAt'>
  unreadCount: number
  pinned: boolean
  muted: boolean
  hidden: boolean
  updatedAt: number
  memberRole?: RoomMember['role']
  canDelete?: boolean
}
