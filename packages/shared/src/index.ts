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

export type AgentReplyMode = 'mention_only' | 'auto_when_relevant'
export type RoomAgentRole = 'assistant' | 'specialist'

export interface AgentToolPermissions {
  chat: boolean
  task: boolean
  file: boolean
  tab: boolean
  interaction: boolean
  members: boolean
}

export interface AgentBehaviorConfig {
  replyMode: AgentReplyMode
  silentAllowed: boolean
}

export interface AgentRuntimeConfig {
  systemPrompt?: string
  behavior?: Partial<AgentBehaviorConfig>
  tools?: Partial<AgentToolPermissions>
  model?: {
    provider?: string
    model?: string
    temperature?: number
    maxTokens?: number
  }
  defaultRoomAssistant?: boolean
  roomId?: string
}

export interface Agent {
  id: string
  name: string
  roleType: 'assistant' | 'specialist'
  deployment: 'server' | 'client'
  description?: string
  specialties?: string[]
  config?: AgentRuntimeConfig
  status?: 'active' | 'inactive' | 'working' | 'error'
  onlineStatus?: 'online' | 'working' | 'offline' | 'error'
  lastActiveAt?: number
  lastError?: string
  sessionId?: string
  roomRole?: RoomAgentRole
  autoEnabled?: boolean
  roomPriority?: number
}

export const DEFAULT_AGENT_TOOLS: AgentToolPermissions = {
  chat: true,
  task: true,
  file: true,
  tab: true,
  interaction: true,
  members: true,
}

export const DEFAULT_ASSISTANT_AGENT_CONFIG: AgentRuntimeConfig = {
  behavior: { replyMode: 'auto_when_relevant', silentAllowed: true },
  tools: DEFAULT_AGENT_TOOLS,
}

export const DEFAULT_SPECIALIST_AGENT_CONFIG: AgentRuntimeConfig = {
  behavior: { replyMode: 'mention_only', silentAllowed: true },
  tools: { chat: true, task: true, file: true, tab: false, interaction: true, members: true },
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
  kind?: 'text' | 'interaction_request' | 'system' | 'agent_receipt'
  payload?: Record<string, any>
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

export interface TaskItem {
  id: string
  taskId: string
  title: string
  description?: string
  status: TaskStatus
  assigneeId?: string
  assigneeName?: string
  assigneeType?: 'human' | 'agent'
  sortOrder: number
  createdBy: string
  createdAt: number
  updatedAt: number
  completedAt?: number
}

export interface TaskSubtaskSummary {
  total: number
  done: number
  todo: number
  assigned: number
  doing: number
  review: number
  blocked: number
  failed: number
  cancelled: number
  progress: number
}

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
  progressNote?: string
  createdBy: string
  createdAt: number
  updatedAt: number
  completedAt?: number
  subtasks?: TaskItem[]
  subtaskSummary?: TaskSubtaskSummary
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

// === Interaction Types ===
export type InteractionType = 'confirm' | 'choice' | 'multi_choice'
export type InteractionStatus = 'pending' | 'resolved' | 'cancelled' | 'expired'
export type InteractionPriority = 'normal' | 'important' | 'danger'

export interface InteractionOption {
  value: string
  label: string
  style?: 'primary' | 'secondary' | 'danger'
  input?: {
    enabled: boolean
    required?: boolean
    placeholder?: string
    multiline?: boolean
    maxLength?: number
  }
}

export interface InteractionRequest {
  id: string
  roomId: string
  messageId?: string
  createdBy: string
  targetUserId?: string
  type: InteractionType
  title: string
  description?: string
  options: InteractionOption[]
  status: InteractionStatus
  result?: {
    value: string | string[]
    labels: string[]
    inputs?: Record<string, string>
  }
  priority?: InteractionPriority
  responsePolicy?: { allowChange?: boolean; allowCancel?: boolean }
  consumedBy?: string
  consumedAt?: number
  expiresAt?: number
  createdAt: number
  updatedAt: number
  resolvedBy?: string
  resolvedAt?: number
}

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

// === Agent Run Types ===
export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface AgentRun {
  id: string
  roomId: string
  agentId: string
  status: AgentRunStatus
  input: string
  output?: string
  error?: string
  sessionId?: string
  startedAt: number
  finishedAt?: number
}

// === WebSocket Message Types ===
export type WSMessageType = 'api_request' | 'api_response' | 'broadcast' | 'system'

export type WSEventAction =
  | 'connected'
  | 'error'
  | 'room.joined'
  | 'room.member_join'
  | 'room.member_leave'
  | 'room.online_update'
  | 'chat.message'
  | 'chat.history_result'
  | 'chat.edited'
  | 'chat.deleted'
  | 'chat.typing_update'
  | 'interaction.created'
  | 'interaction.updated'
  | 'task.list_result'
  | 'task.changed'
  | 'agent.status_update'
  | 'files.updated'
  | 'tabs.updated'

export interface WSMessage<TPayload extends Record<string, any> = Record<string, any>> {
  msgId: string
  roomId: string
  type: WSMessageType
  action: WSEventAction | string
  payload: TPayload
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
