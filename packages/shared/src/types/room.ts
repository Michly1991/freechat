import type { UserIdentityType } from './user.js'

// === Room Types ===
export interface Room {
  id: string
  name: string
  description?: string
  createdBy: string
  createdAt: number
  updatedAt: number
  lastActiveAt: number
  roomKind?: 'project' | 'group' | 'direct_user' | 'direct_agent'
  currentAssistantAgentId?: string
  assistantMode?: 'fixed' | 'handoff'
  assistantHandoffAt?: number
  assistantHandoffBy?: string
  members?: RoomMember[]
}

export interface RoomMember {
  userId: string
  username: string
  nickname: string
  avatar?: string
  role: 'owner' | 'editor' | 'viewer'
  type: UserIdentityType
  identityType?: UserIdentityType
  joinedAt: number
}
