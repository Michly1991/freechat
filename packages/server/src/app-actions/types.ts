import type { AppActionMeta, AppActionRisk } from './registry.js'

export type ToolTransport =
  | 'legacy-agent-tools'
  | 'remote-app-call'
  | 'platform-inline'
  | 'platform-auto-read'
  | 'agent-cli'
  | 'server-internal'

export interface ToolExecutionContext {
  roomId: string
  action: string
  args: any
  agentId: string
  actorUserId: string
  actorRole?: string
  scopeRoomId?: string
  runId?: string
  streamId?: string
  connectorId?: string
  transport: ToolTransport
  recordMindmapPreview?: boolean
  emitActivity?: (tool: string) => void
  remoteAuth?: any
}

export interface ToolExecutionOptions {
  audit?: boolean
  messageService?: any
  db?: any
}

export interface ToolExecutionResult<T = any> {
  success: boolean
  data?: T
  message?: string
  error?: { code: string; message: string; details?: any }
}

export interface ToolDefinition extends AppActionMeta {
  canonicalAction: string
  risk: AppActionRisk
}
