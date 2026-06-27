import type { UserIdentityType } from './user.js'

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

export interface AgentDreamMemoryItem {
  type: string
  text: string
  source?: string
  count?: number
  lastTriggeredAt?: number
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
  builtInKey?: string
  locked?: boolean
  dreamMemory?: AgentDreamMemoryItem[]
}

export interface RoomAgentModelConfig {
  modelProfileId?: string
  model?: string
  runtime?: 'claude-code'
  maxTokens?: number
  temperature?: number
  modelSource?: 'platform' | 'user_owned' | 'marketplace' | 'client_reported' | 'system_default'
  modelProfileName?: string
  modelProfileOwnerId?: string
  modelProfileOwnerName?: string
  scope?: 'agent_default' | 'room_override' | 'platform_default'
  inheritedFromAgent?: boolean
  allowPaidSharedModel?: boolean
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
  roomModelConfig?: RoomAgentModelConfig
  defaultModelConfig?: RoomAgentModelConfig
  isTemplate?: boolean
  templateVersion?: number
  sourceTemplateId?: string
  sourceTemplateVersion?: number
  isModified?: boolean
  ownerId?: string
  ownerName?: string
  isBuiltIn?: boolean
  builtInKey?: string
  canEdit?: boolean
  canDelete?: boolean
  managedByClient?: boolean
  clientConnectorCount?: number
  clientConnectorId?: string
  clientConnectorName?: string
  clientConnectorStatus?: 'online' | 'working' | 'offline' | 'error' | 'revoked' | string
  clientLastSeenAt?: number
}

export interface AgentSkill {
  id: string
  agentId: string
  name: string
  description?: string
  content: string
  enabled: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface AgentScript {
  id: string
  agentId: string
  name: string
  description?: string
  language: string
  content: string
  enabled: boolean
  runPolicy: 'manual_only' | 'agent_allowed' | 'disabled'
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface SceneTemplate {
  id: string
  ownerId?: string
  builtInKey?: string
  name: string
  description?: string
  icon?: string
  version: number
  status: 'active' | 'inactive'
  isBuiltIn?: boolean
  canEdit?: boolean
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
  tools: { chat: true, task: true, file: true, tab: true, interaction: true, members: true },
}
