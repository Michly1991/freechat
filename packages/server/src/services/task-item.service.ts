import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import type { TaskStatus } from '@freechat/shared'

export interface TaskItem {
  id: string
  taskId: string
  title: string
  description?: string
  status: TaskStatus
  assigneeId?: string
  assigneeName?: string
  assigneeType?: 'human' | 'agent'
  sortOrder: number
  createdBy: string
  createdAt: number
  updatedAt: number
  completedAt?: number
}

const TASK_STATUSES = new Set<TaskStatus>(['todo', 'assigned', 'doing', 'review', 'blocked', 'done', 'failed', 'cancelled'])
const DONE_STATUSES = new Set<TaskStatus>(['done', 'cancelled'])
const ACTIVE_CHILD_STATUSES = new Set<TaskStatus>(['doing', 'review', 'blocked', 'done'])

function assertTaskItemStatus(status: unknown): asserts status is TaskStatus {
  if (!TASK_STATUSES.has(status as TaskStatus)) throw { code: 'VALIDATION_ERROR', message: `invalid subtask status: ${status}` }
}

export function rowToTaskItem(row: any): TaskItem {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    description: row.description || undefined,
    status: row.status,
    assigneeId: row.assignee_id || undefined,
    assigneeName: row.assignee_name || undefined,
    assigneeType: row.assignee_type || undefined,
    sortOrder: row.sort_order || 0,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at || undefined,
  }
}

export class TaskItemService {
  list(taskId: string): TaskItem[] {
    const rows = db.prepare('SELECT * FROM task_items WHERE task_id = ? ORDER BY sort_order ASC, created_at ASC').all(taskId) as any[]
    return rows.map(rowToTaskItem)
  }

  listForTasks(taskIds: string[]): Record<string, TaskItem[]> {
    if (taskIds.length === 0) return {}
    const rows = db.prepare(`SELECT * FROM task_items WHERE task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY task_id ASC, sort_order ASC, created_at ASC`).all(...taskIds) as any[]
    const grouped: Record<string, TaskItem[]> = {}
    rows.forEach((row) => {
      const item = rowToTaskItem(row)
      if (!grouped[item.taskId]) grouped[item.taskId] = []
      grouped[item.taskId].push(item)
    })
    return grouped
  }

  summary(items: TaskItem[]) {
    const summary: any = { total: items.length, done: 0, todo: 0, assigned: 0, doing: 0, review: 0, blocked: 0, failed: 0, cancelled: 0, progress: 0 }
    items.forEach((item) => {
      summary[item.status] = (summary[item.status] || 0) + 1
    })
    summary.progress = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0
    return summary
  }

  async create(taskId: string, args: { title: string; description?: string; status?: TaskStatus; assigneeId?: string; assigneeName?: string; assigneeType?: 'human' | 'agent'; createdBy: string }): Promise<TaskItem> {
    const title = String(args.title || '').trim()
    if (!title) throw { code: 'VALIDATION_ERROR', message: 'title is required' }
    const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId)
    if (!task) throw { code: 'TASK_NOT_FOUND', message: 'Task not found' }
    const maxOrder: any = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM task_items WHERE task_id = ?').get(taskId)
    const now = Date.now()
    const status = args.status || (args.assigneeId ? 'assigned' : 'todo')
    assertTaskItemStatus(status)
    const completedAt = DONE_STATUSES.has(status) ? now : null
    const id = `titem_${uuidv4()}`
    db.prepare(`
      INSERT INTO task_items (id, task_id, title, description, status, assignee_id, assignee_name, assignee_type, sort_order, created_by, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, taskId, title, args.description || null, status, args.assigneeId || null, args.assigneeName || null, args.assigneeType || null, (maxOrder?.max_order ?? -1) + 1, args.createdBy, now, now, completedAt)
    this.promoteParentWhenChildActive(taskId, status)
    return this.get(id)
  }

  get(itemId: string): TaskItem {
    const row = db.prepare('SELECT * FROM task_items WHERE id = ?').get(itemId) as any
    if (!row) throw { code: 'TASK_ITEM_NOT_FOUND', message: 'Subtask not found' }
    return rowToTaskItem(row)
  }

  async update(itemId: string, updates: Partial<TaskItem>): Promise<TaskItem> {
    const fields: string[] = []
    const values: any[] = []
    if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title) }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
    if (updates.status !== undefined) {
      assertTaskItemStatus(updates.status)
      fields.push('status = ?')
      values.push(updates.status)
      fields.push('completed_at = ?')
      values.push(DONE_STATUSES.has(updates.status) ? Date.now() : null)
    }
    if (updates.assigneeId !== undefined) { fields.push('assignee_id = ?'); values.push(updates.assigneeId) }
    if (updates.assigneeName !== undefined) { fields.push('assignee_name = ?'); values.push(updates.assigneeName) }
    if (updates.assigneeType !== undefined) { fields.push('assignee_type = ?'); values.push(updates.assigneeType) }
    if (updates.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(updates.sortOrder) }
    if (fields.length === 0) return this.get(itemId)
    fields.push('updated_at = ?')
    values.push(Date.now(), itemId)
    const before = this.get(itemId)
    const result = db.prepare(`UPDATE task_items SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    if (result.changes === 0) throw { code: 'TASK_ITEM_NOT_FOUND', message: 'Subtask not found' }
    if (updates.status !== undefined) this.promoteParentWhenChildActive(before.taskId, updates.status)
    return this.get(itemId)
  }

  private promoteParentWhenChildActive(taskId: string, status: TaskStatus) {
    if (!ACTIVE_CHILD_STATUSES.has(status)) return
    db.prepare(`
      UPDATE tasks
      SET status = 'doing', updated_at = ?
      WHERE id = ? AND status IN ('todo', 'assigned')
    `).run(Date.now(), taskId)
  }

  async delete(itemId: string): Promise<void> {
    const result = db.prepare('DELETE FROM task_items WHERE id = ?').run(itemId)
    if (result.changes === 0) throw { code: 'TASK_ITEM_NOT_FOUND', message: 'Subtask not found' }
  }
}

export const taskItemService = new TaskItemService()
