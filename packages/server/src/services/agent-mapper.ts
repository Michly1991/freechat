import type { Agent, AgentRuntimeConfig, RoomAgentModelConfig, RoomAgentRole } from '@freechat/shared'
import { DEFAULT_ASSISTANT_AGENT_CONFIG, DEFAULT_SPECIALIST_AGENT_CONFIG } from '@freechat/shared'

export interface AgentRow {
  id: string
  owner_id: string
  owner_name?: string | null
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
  room_model_config?: string | null
  is_template?: number | null
  template_version?: number | null
  source_template_id?: string | null
  source_template_version?: number | null
  is_modified?: number | null
  market_listed?: number | null
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

function parseRoomModelConfig(value?: string | null): RoomAgentModelConfig | undefined {
  if (!value) return undefined
  try { return JSON.parse(value) as RoomAgentModelConfig } catch { return undefined }
}

export function rowToAgent(row: AgentRow): Agent {
  const config = row.config ? JSON.parse(row.config) : undefined
  const builtInKey = config?.builtInKey
  const isBuiltIn = !!builtInKey || !!config?.locked
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
    ownerId: row.owner_id,
    ownerName: row.owner_name || undefined,
    name: row.name,
    roleType: row.role_type as 'assistant' | 'specialist',
    deployment: row.deployment as 'server' | 'client',
    description: row.description || undefined,
    specialties: row.specialties ? JSON.parse(row.specialties) : undefined,
    config,
    status,
    onlineStatus,
    lastActiveAt: row.agent_last_active_at || undefined,
    sessionId: row.session_id || undefined,
    roomRole: (row.room_role as RoomAgentRole) || undefined,
    autoEnabled: row.auto_enabled !== undefined && row.auto_enabled !== null ? !!row.auto_enabled : undefined,
    roomPriority: row.room_priority ?? undefined,
    roomModelConfig: parseRoomModelConfig(row.room_model_config),
    isTemplate: row.is_template !== undefined && row.is_template !== null ? !!row.is_template : undefined,
    templateVersion: row.template_version ?? undefined,
    sourceTemplateId: row.source_template_id || undefined,
    sourceTemplateVersion: row.source_template_version ?? undefined,
    isModified: row.is_modified !== undefined && row.is_modified !== null ? !!row.is_modified : undefined,
    isBuiltIn,
    builtInKey,
    marketListed: row.market_listed !== undefined && row.market_listed !== null ? !!row.market_listed : false,
    canDelete: !isBuiltIn,
  } as Agent
}
