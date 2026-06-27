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
  blockedReason?: string
  dependencies?: string[]
  sortOrder: number
  createdBy: string
  createdAt: number
  updatedAt: number
  completedAt?: number
  retryCount?: number
  lastRetryAt?: number
  lastRetryBy?: string
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
  retryCount?: number
  lastRetryAt?: number
  lastRetryBy?: string
  subtasks?: TaskItem[]
  subtaskSummary?: TaskSubtaskSummary
}
