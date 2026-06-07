import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import type { Task, TaskStatus, TaskPriority } from '@freechat/shared'

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
    const id = `task_${uuidv4()}`
    const now = Date.now()
    const status = assigneeId ? 'assigned' : 'todo'

    db.prepare(`
      INSERT INTO tasks (id, room_id, title, description, status, priority, assignee_id, assignee_name, assignee_type, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, roomId, title, description || null, status, priority, assigneeId || null, assigneeName || null, assigneeType || null, createdBy || 'system', now, now)

    return this.getTask(id)
  }

  async getTask(taskId: string): Promise<Task> {
    const row: any = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId)
    if (!row) {
      throw { code: 'TASK_NOT_FOUND', message: 'Task not found' }
    }

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
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at
    }
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

    return rows.map(row => ({
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
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at
    }))
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
      fields.push('status = ?')
      values.push(updates.status)
      if (updates.status === 'done' || updates.status === 'cancelled') {
        fields.push('completed_at = ?')
        values.push(Date.now())
      }
    }
    if (updates.priority !== undefined) {
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
    if (updates.blockedReason !== undefined) {
      fields.push('blocked_reason = ?')
      values.push(updates.blockedReason)
    }
    if (updates.reviewNote !== undefined) {
      fields.push('review_note = ?')
      values.push(updates.reviewNote)
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
