import db from '../storage/db.js'
import { taskService } from './task.service.js'
import { taskItemService, type TaskItem } from './task-item.service.js'

const RETRYABLE = new Set(['failed', 'cancelled', 'blocked'])

function depsReady(itemId: string): boolean {
  const deps = db.prepare(`
    SELECT ti.status FROM task_item_dependencies d
    INNER JOIN task_items ti ON ti.id = d.depends_on_item_id
    WHERE d.item_id = ?
  `).all(itemId) as any[]
  return deps.length === 0 || deps.every((dep) => dep.status === 'done' || dep.status === 'cancelled')
}

function retryStatus(item: TaskItem) {
  if (!depsReady(item.id)) return { status: 'blocked' as const, blockedReason: '等待前置子任务完成后重试' }
  return { status: item.assigneeId ? 'assigned' as const : 'todo' as const, blockedReason: '' }
}

export class TaskRetryService {
  retrySubtask(itemId: string, userId: string, reason = '人工重试') {
    const before = taskItemService.get(itemId)
    const next = retryStatus(before)
    const now = Date.now()
    db.prepare(`
      UPDATE task_items
      SET retry_count = COALESCE(retry_count, 0) + 1,
          last_retry_at = ?, last_retry_by = ?, status = ?, blocked_reason = ?, completed_at = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, userId, next.status, next.blockedReason || null, now, itemId)
    const subtask = taskItemService.get(itemId)
    db.prepare('UPDATE tasks SET retry_count = COALESCE(retry_count, 0) + 1, last_retry_at = ?, last_retry_by = ? WHERE id = ?').run(now, userId, before.taskId)
    const task = taskService.updateTask(before.taskId, { progressNote: `用户发起子任务重试：${before.title}${reason ? `（${reason}）` : ''}` } as any)
    return Promise.resolve(task).then((parent) => ({ subtask, task: parent, shouldWake: subtask.assigneeType === 'agent' && !!subtask.assigneeId && subtask.status !== 'blocked' }))
  }

  async retryTaskFailedItems(taskId: string, userId: string, reason = '人工重试') {
    await taskService.assertTaskInRoom(taskId, await taskService.getTaskRoomId(taskId))
    const items = taskItemService.list(taskId).filter((item) => RETRYABLE.has(item.status))
    const retried = [] as TaskItem[]
    for (const item of items) {
      const next = retryStatus(item)
      const now = Date.now()
      db.prepare(`
        UPDATE task_items
        SET retry_count = COALESCE(retry_count, 0) + 1,
            last_retry_at = ?, last_retry_by = ?, status = ?, blocked_reason = ?, completed_at = NULL, updated_at = ?
        WHERE id = ?
      `).run(now, userId, next.status, next.blockedReason || null, now, item.id)
      retried.push(taskItemService.get(item.id))
    }
    db.prepare('UPDATE tasks SET retry_count = COALESCE(retry_count, 0) + 1, last_retry_at = ?, last_retry_by = ? WHERE id = ?').run(Date.now(), userId, taskId)
    const task = await taskService.updateTask(taskId, { status: 'doing', progressNote: `用户发起重试失败项，共 ${retried.length} 项${reason ? `（${reason}）` : ''}` } as any)
    return { task, retried, wakeItems: retried.filter((item) => item.assigneeType === 'agent' && item.assigneeId && item.status !== 'blocked') }
  }
}

export const taskRetryService = new TaskRetryService()
