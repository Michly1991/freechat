export type AgentCredential = {
  agentId: string
  connectorId: string
  accessToken: string
  connectorToken: string
  name?: string
  enabled: boolean
  maxConcurrency: number
  workdir?: string
  status?: 'idle' | 'running' | 'error' | 'disabled'
  lastSeenAt?: number
  lastError?: string
  createdAt: number
  updatedAt: number
}

export type ClientConfig = {
  serverUrl: string
  clientName: string
  host: string
  port: number
  publicUrl?: string
  adminPassword?: string
  serverAuthToken?: string
  serverUsername?: string
  serverPassword?: string
  serverUser?: any
  maxConcurrency: number
  pollIntervalMs: number
  agents: AgentCredential[]
}

export type AgentEventContext = {
  version: number
  roomId: string
  agentId: string
  actorUserId?: string
  input: string
  recentMessages?: Array<{ id: string; actorName: string; actorRole: string; kind: string; content: string; attachments?: any[]; createdAt: number }>
  recentFileRefs?: Array<{ id: string; ref: string; name: string; relativePath: string; mimeType?: string; size: number; source: string; messageId?: string; createdAt: number }>
  promptText?: string
}

export type RemoteEvent = {
  id: string
  runId: string
  roomId: string
  agentId: string
  type: string
  payload: { input?: string; mode?: 'soft' | 'force'; clearSession?: boolean; actorUserId?: string; reason?: string; taskId?: string; subtaskId?: string; runSource?: string; responseMode?: 'final_to_chat' | 'tool_only' | 'silent'; metadata?: Record<string, any>; context?: AgentEventContext }
}

export type RuntimeState = {
  workerRunning: boolean
  activeRuns: Record<string, { runId: string; agentId: string; startedAt: number; type: string }>
  logs: string[]
}
