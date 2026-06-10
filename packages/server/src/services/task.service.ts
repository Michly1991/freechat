import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import type { Task, TaskStatus, TaskPriority } from '@freechat/shared'
import { taskItemService } from './task-item.service.js'

const TASK_STATUSES = new Set<TaskStatus>(['todo', 'assigned', 'doing', 'review', 'blocked', 'done', 'failed', 'cancelled'])
const TASK_PRIORITIES = new Set<TaskPriority>(['low', 'medium', 'high'])
const DONE_STATUSES = new Set<TaskStatus>(['done', 'cancelled'])

function assertTaskStatus(status: unknown): asserts status is TaskStatus {
  if (!TASK_STATUSES.has(status as TaskStatus)) throw { code: 'VALIDATION_ERROR', message: `invalid task status: ${status}` }
}

function assertTaskPriority(priority: unknown): asserts priority is TaskPriority {
  if (!TASK_PRIORITIES.has(priority as TaskPriority)) throw { code: 'VALIDATION_ERROR', message: `invalid task priority: ${priority}` }
}

export class TaskService {
  async createTask(
    roomId: string,
    title: string,
    description?: string,
    priority: TaskPriority = 'medium',
    assigneeId?: string,
    assigneeName?: string,
    assigneeType?: 'human' | 'agent',
    createdBy?: string
  ): Promise<Task> {
    const cleanTitle = String(title || '').trim()
    if (!cleanTitle) throw { code: 'VALIDATION_ERROR', message: 'title is required' }
    assertTaskPriority(priority)

    const id = `task_${uuidv4()}`
    const now = Date.now()
    const status = assigneeId ? 'assigned' : 'todo'
    let creator = createdBy
    if (!creator || !db.prepare('SELECT id FROM users WHERE id = ?').get(creator)) {
      const room = db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(roomId) as any
      creator = room?.created_by || creator || 'system'
    }

    db.prepare(`
      INSERT INTO tasks (id, room_id, title, description, status, priority, assignee_id, assignee_name, assignee_type, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, roomId, cleanTitle, description || null, status, priority, assigneeId || null, assigneeName || null, assigneeType || null, creator, now, now)

    return this.getTask(id)
  }

  async getTask(taskId: string): Promise<Task> {
    const row: any = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)
    if (!row) {
      throw { code: 'TASK_NOT_FOUND', message: 'Task not found' }
    }

    const subtasks = taskItemService.list(row.id)
    return {
      id: row.id,
      roomId: row.room_id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assigneeId: row.assignee_id,
      assigneeName: row.assignee_name,
      assigneeType: row.assignee_type,
      blockedReason: row.blocked_reason,
      reviewNote: row.review_note,
      progressNote: row.progress_note,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      retryCount: row.retry_count || 0,
      lastRetryAt: row.last_retry_at || undefined,
      lastRetryBy: row.last_retry_by || undefined,
      subtasks,
      subtaskSummary: taskItemService.summary(subtasks)
    } as any
  }

  async getRoomTasks(roomId: string, status?: TaskStatus): Promise<Task[]> {
    let query = 'SELECT * FROM tasks WHERE room_id = ?'
    const params: any[] = [roomId]

    if (status) {
      query += ' AND status = ?'
      params.push(status)
    }

    query += ' ORDER BY created_at DESC'

    const rows: any[] = db.prepare(query).all(...params)

    const groupedItems = taskItemService.listForTasks(rows.map((row) => row.id))
    return rows.map(row => {
      const subtasks = groupedItems[row.id] || []
      return {
        id: row.id,
        roomId: row.room_id,
        title: row.title,
        description: row.description,
        status: row.status,
        priority: row.priority,
        assigneeId: row.assignee_id,
        assigneeName: row.assignee_name,
        assigneeType: row.assignee_type,
        blockedReason: row.blocked_reason,
        reviewNote: row.review_note,
        progressNote: row.progress_note,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at,
        retryCount: row.retry_count || 0,
        lastRetryAt: row.last_retry_at || undefined,
        lastRetryBy: row.last_retry_by || undefined,
        subtasks,
        subtaskSummary: taskItemService.summary(subtasks)
      } as any
    })
  }

  async assertTaskInRoom(taskId: string, roomId: string): Promise<void> {
    const row = db.prepare('SELECT room_id FROM tasks WHERE id = ?').get(taskId) as any
    if (!row) throw { code: 'TASK_NOT_FOUND', message: 'Task not found' }
    if (row.room_id !== roomId) throw { code: 'TASK_ROOM_MISMATCH', message: 'Task does not belong to current room' }
  }

  async getTaskRoomId(taskId: string): Promise<string> {
    const row = db.prepare('SELECT room_id FROM tasks WHERE id = ?').get(taskId) as any
    if (!row) throw { code: 'TASK_NOT_FOUND', message: 'Task not found' }
    return row.room_id
  }

  async updateTask(taskId: string, updates: Partial<Task>): Promise<Task> {
    const fields: string[] = []
    const values: any[] = []

    if (updates.title !== undefined) {
      fields.push('title = ?')
      values.push(updates.title)
    }
    if (updates.description !== undefined) {
      fields.push('description = ?')
      values.push(updates.description)
    }
    if (updates.status !== undefined) {
      assertTaskStatus(updates.status)
      fields.push('status = ?')
      values.push(updates.status)
      fields.push('completed_at = ?')
      values.push(DONE_STATUSES.has(updates.status) ? Date.now() : null)
    }
    if (updates.priority !== undefined) {
      assertTaskPriority(updates.priority)
      fields.push('priority = ?')
      values.push(updates.priority)
    }
    if (updates.assigneeId !== undefined) {
      fields.push('assignee_id = ?')
      values.push(updates.assigneeId)
    }
    if (updates.assigneeName !== undefined) {
      fields.push('assignee_name = ?')
      values.push(updates.assigneeName)
    }
    if (updates.assigneeType !== undefined) {
      fields.push('assignee_type = ?')
      values.push(updates.assigneeType)
    }
    if (updates.blockedReason !== undefined) {
      fields.push('blocked_reason = ?')
      values.push(updates.blockedReason)
    }
    if (updates.reviewNote !== undefined) {
      fields.push('review_note = ?')
      values.push(updates.reviewNote)
    }
    if ((updates as any).progressNote !== undefined) {
      fields.push('progress_note = ?')
      values.push((updates as any).progressNote)
    }

    if (fields.length === 0) {
      return this.getTask(taskId)
    }

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(taskId)

    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return this.getTask(taskId)
  }

  async deleteTask(taskId: string): Promise<void> {
    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId)
  }
}

export const taskService = new TaskService()
