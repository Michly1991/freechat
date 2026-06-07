// Shared type definitions for FreeChat

// === User & Agent Types ===
export interface User {
  id: string
  username: string
  nickname: string
  avatar?: string
  role: 'user' | 'admin'
  createdAt: number
}

export interface Agent {
  id: string
  name: string
  roleType: 'assistant' | 'specialist'
  deployment: 'server' | 'client'
  description?: string
  specialties?: string[]
  config?: Record<string, any>
  status?: 'active' | 'inactive' | 'working'
  sessionId?: string
}

// === Room Types ===
export interface Room {
  id: string
  name: string
  description?: string
  createdBy: string
  createdAt: number
  updatedAt: number
  lastActiveAt: number
}

export interface RoomMember {
  userId: string
  username: string
  nickname: string
  avatar?: string
  role: 'owner' | 'editor' | 'viewer'
  type: 'human' | 'agent'
  joinedAt: number
}

// === Message Types ===
export interface Message {
  id: string
  roomId: string
  actorId: string
  actorName: string
  actorRole: 'human' | 'ai'
  content: string
  mentions?: Mention[]
  replyTo?: string
  editedAt?: number
  deleted: boolean
  createdAt: number
}

export interface Mention {
  id: string
  name: string
  role: 'human' | 'ai'
}

// === Task Types ===
export type TaskStatus = 
  | 'todo'
  | 'assigned'
  | 'doing'
  | 'review'
  | 'blocked'
  | 'done'
  | 'failed'
  | 'cancelled'

export type TaskPriority = 'low' | 'medium' | 'high'

export interface Task {
  id: string
  roomId: string
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  assigneeId?: string
  assigneeName?: string
  assigneeType?: 'human' | 'agent'
  blockedReason?: string
  reviewNote?: string
  createdBy: string
  createdAt: number
  updatedAt: number
  completedAt?: number
}

// === Tab Types ===
export interface Tab {
  id: string
  roomId: string
  title: string
  icon?: string
  sortOrder: number
  createdBy: string
  createdAt: number
  updatedAt: number
}

// === WebSocket Message Types ===
export type WSMessageType = 'api_request' | 'api_response' | 'broadcast' | 'system'

export interface WSMessage {
  msgId: string
  roomId: string
  type: WSMessageType
  action: string
  payload: Record<string, any>
  actor?: {
    id: string
    name: string
    role: 'human' | 'ai'
    avatar?: string
  }
  timestamp: number
}

// === API Response Types ===
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
  }
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

// === Auth Types ===
export interface LoginRequest {
  username: string
  password: string
}

export interface RegisterRequest {
  username: string
  password: string
  nickname: string
}

export interface AuthResponse {
  user: User
  token: string
}

// === Constants ===
export const MAX_MESSAGES_PER_ROOM = 100
export const TASK_STATUS_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ['assigned', 'cancelled'],
  assigned: ['doing', 'todo', 'cancelled'],
  doing: ['review', 'blocked', 'done', 'failed', 'cancelled'],
  review: ['done', 'doing', 'cancelled'],
  blocked: ['doing', 'assigned', 'cancelled'],
  done: ['todo'],
  failed: ['todo', 'doing', 'cancelled'],
  cancelled: ['todo']
}

export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  NOT_ROOM_MEMBER: 'NOT_ROOM_MEMBER',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  TAB_NOT_FOUND: 'TAB_NOT_FOUND',
  TASK_NOT_FOUND: 'TASK_NOT_FOUND',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  INVALID_PASSWORD: 'INVALID_PASSWORD',
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  INVITE_FULL: 'INVITE_FULL',
  RATE_LIMITED: 'RATE_LIMITED'
} as const
