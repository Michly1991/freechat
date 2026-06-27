// === Agent Run Types ===
export type AgentRunStatus = 'running' | 'succeeded' | 'failed' | 'timeout' | 'cancelled'

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
