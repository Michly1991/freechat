export interface AgentRunContext {
  runSource?: 'chat' | 'task' | 'subtask' | 'task_plan' | 'manual' | 'resume' | 'handoff'
  taskId?: string
  subtaskId?: string
  parentRunId?: string
  resumeAttempt?: number
  responseMode?: 'final_to_chat' | 'tool_only' | 'silent'
  metadata?: Record<string, any>
}
