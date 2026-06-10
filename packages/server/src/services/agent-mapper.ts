import type { Agent, AgentRuntimeConfig, RoomAgentRole } from '@freechat/shared'
import { DEFAULT_ASSISTANT_AGENT_CONFIG, DEFAULT_SPECIALIST_AGENT_CONFIG } from '@freechat/shared'

export interface AgentRow {
  id: string
  owner_id: string
  name: string
  role_type: string
  deployment: string
  description: string | null
  specialties: string | null
  config: string | null
  api_key_hash: string | null
  status: string
  session_id: string | null
  created_at: number
  updated_at: number
  agent_last_active_at?: number | null
  room_role?: string | null
  auto_enabled?: number | null
  room_priority?: number | null
}

export function mergeAgentConfig(roleType: 'assistant' | 'specialist', config?: AgentRuntimeConfig): AgentRuntimeConfig {
  const base = roleType === 'assistant' ? DEFAULT_ASSISTANT_AGENT_CONFIG : DEFAULT_SPECIALIST_AGENT_CONFIG
  return {
    ...base,
    ...(config || {}),
    behavior: { ...(base.behavior || {}), ...(config?.behavior || {}) },
    tools: { ...(base.tools || {}), ...(config?.tools || {}) },
    model: { ...(base.model || {}), ...(config?.model || {}) },
  }
}

export function rowToAgent(row: AgentRow): Agent {
  const status = (row.status as 'active' | 'inactive' | 'working' | 'error') || 'active'
  const onlineStatus = status === 'working'
    ? 'working'
    : status === 'inactive'
      ? 'offline'
      : status === 'error'
        ? 'error'
        : 'online'

  return {
    id: row.id,
    name: row.name,
    roleType: row.role_type as 'assistant' | 'specialist',
    deployment: row.deployment as 'server' | 'client',
    description: row.description || undefined,
    specialties: row.specialties ? JSON.parse(row.specialties) : undefined,
    config: row.config ? JSON.parse(row.config) : undefined,
    status,
    onlineStatus,
    lastActiveAt: row.agent_last_active_at || undefined,
    sessionId: row.session_id || undefined,
    roomRole: (row.room_role as RoomAgentRole) || undefined,
    autoEnabled: row.auto_enabled !== undefined && row.auto_enabled !== null ? !!row.auto_enabled : undefined,
    roomPriority: row.room_priority ?? undefined,
  }
}
