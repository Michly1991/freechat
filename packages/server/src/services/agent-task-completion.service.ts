import { taskService } from './task.service.js'
import { taskItemService, type TaskItem } from './task-item.service.js'

function extractSubtaskId(input: string): string | undefined {
  return input.match(/子任务ID[:：]\s*(titem_[\w-]+)/)?.[1]
}

function looksCompleted(output: string): boolean {
  const text = String(output || '')
  const positive = /完成|已完成|写入|保存|已保存|生成/.test(text)
  const hardNegative = /无法完成|未完成|任务失败|产物失败|写入失败|保存失败/.test(text)
  return positive && !hardNegative
}

export class AgentTaskCompletionService {
  async autoCompleteFromRun(input: string, output: string) {
    const itemId = extractSubtaskId(input)
    if (!itemId || !looksCompleted(output)) return null
    const before = taskItemService.get(itemId)
    if (before.status === 'done') return { task: await taskService.getTask(before.taskId), subtask: before, released: [] as TaskItem[] }
    const subtask = await taskItemService.update(itemId, { status: 'done' } as any)
    const released: TaskItem[] = []
    for (const item of taskItemService.readyDependents(subtask.id)) released.push(await taskItemService.releaseDependent(item.id))
    const task = await taskService.getTask(subtask.taskId)
    return { task, subtask, released }
  }
}

export const agentTaskCompletionService = new AgentTaskCompletionService()
