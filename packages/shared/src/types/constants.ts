import type { TaskStatus } from './task.js'

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
