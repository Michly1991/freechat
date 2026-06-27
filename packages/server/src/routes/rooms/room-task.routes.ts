import { FastifyInstance } from 'fastify'
import { v4 as uuidv4 } from 'uuid'
import { roomService } from '../../services/room.service.js'
import { taskService } from '../../services/task.service.js'
import { taskItemService } from '../../services/task-item.service.js'
import { taskRetryService } from '../../services/task-retry.service.js'
import { notificationService } from '../../services/notification.service.js'
import { getGateway } from '../../ws/gateway.js'

export async function registerRoomTaskRoutes(app: FastifyInstance) {
// Get room tasks
app.get('/api/rooms/:id/tasks', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  const { status } = request.query as any

  const isMember = await roomService.isMember(id, user.id)
  if (!isMember) {
    return reply.code(403).send({
      success: false,
      error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' }
    })
  }

  const tasks = await taskService.getRoomTasks(id, status)
  return reply.send({ success: true, data: { tasks } })
})

// Create task via REST (WS parity)
app.post('/api/rooms/:id/tasks', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  const body = request.body as any
  const isMember = await roomService.isMember(id, user.id)
  if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
  const task = await taskService.createTask(id, body.title, body.description, body.priority, body.assigneeId || body.assignee_id, body.assigneeName || body.assignee_name, body.assigneeType || body.assignee_type, user.id)
  notificationService.notifyTaskAssigned({ roomId: id, taskId: task.id, title: task.title, assigneeId: task.assigneeId, assigneeType: task.assigneeType, actorId: user.id, actorName: user.nickname || user.username })
  getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'add', task }, timestamp: Date.now() })
  return reply.code(201).send({ success: true, data: { task } })
})

// Update task via REST (WS parity)
app.patch('/api/rooms/:id/tasks/:taskId', async (request, reply) => {
  const user = (request as any).user
  const { id, taskId } = request.params as any
  const body = request.body as any
  const isMember = await roomService.isMember(id, user.id)
  if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
  await taskService.assertTaskInRoom(taskId, id)
  const beforeTask = await taskService.getTask(taskId)
  const updates = body.updates || body
  const task = await taskService.updateTask(taskId, updates)
  if (task.assigneeId && task.assigneeId !== beforeTask.assigneeId) notificationService.notifyTaskAssigned({ roomId: id, taskId: task.id, title: task.title, assigneeId: task.assigneeId, assigneeType: task.assigneeType, actorId: user.id, actorName: user.nickname || user.username })
  if (task.status !== beforeTask.status) notificationService.notifyTaskDone({ roomId: id, taskId: task.id, title: task.title, createdBy: task.createdBy, actorId: user.id, actorName: user.nickname || user.username, status: task.status })
  getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task }, timestamp: Date.now() })
  return reply.send({ success: true, data: { task } })
})

// Delete task via REST (WS parity)
app.delete('/api/rooms/:id/tasks/:taskId', async (request, reply) => {
  const user = (request as any).user
  const { id, taskId } = request.params as any
  const isMember = await roomService.isMember(id, user.id)
  if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
  await taskService.assertTaskInRoom(taskId, id)
  await taskService.deleteTask(taskId)
  getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'delete', task_id: taskId }, timestamp: Date.now() })
  return reply.send({ success: true })
})

// Retry failed task items via REST
app.post('/api/rooms/:id/tasks/:taskId/retry', async (request, reply) => {
  const user = (request as any).user
  const { id, taskId } = request.params as any
  const { reason } = request.body as any || {}
  const isMember = await roomService.isMember(id, user.id)
  if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
  await taskService.assertTaskInRoom(taskId, id)
  const result = await taskRetryService.retryTaskFailedItems(taskId, user.id, reason)
  getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task: result.task }, timestamp: Date.now() })
  return reply.send({ success: true, data: result })
})

// Create subtask via REST
app.post('/api/rooms/:id/tasks/:taskId/subtasks', async (request, reply) => {
  const user = (request as any).user
  const { id, taskId } = request.params as any
  const body = request.body as any
  const isMember = await roomService.isMember(id, user.id)
  if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
  await taskService.assertTaskInRoom(taskId, id)
  const subtask = await taskItemService.create(taskId, { title: body.title, description: body.description, status: body.status, assigneeId: body.assigneeId || body.assignee_id, assigneeName: body.assigneeName || body.assignee_name, assigneeType: body.assigneeType || body.assignee_type, blockedReason: body.blockedReason || body.blocked_reason, createdBy: user.id })
  notificationService.notifyTaskAssigned({ roomId: id, taskId, title: subtask.title, assigneeId: subtask.assigneeId, assigneeType: subtask.assigneeType, actorId: user.id, actorName: user.nickname || user.username, isSubtask: true })
  const task = await taskService.getTask(taskId)
  getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task }, timestamp: Date.now() })
  return reply.code(201).send({ success: true, data: { subtask, task } })
})

// Update subtask via REST
app.patch('/api/rooms/:id/tasks/:taskId/subtasks/:itemId', async (request, reply) => {
  const user = (request as any).user
  const { id, taskId, itemId } = request.params as any
  const body = request.body as any
  const isMember = await roomService.isMember(id, user.id)
  if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
  await taskService.assertTaskInRoom(taskId, id)
  const before = taskItemService.get(itemId)
  if (before.taskId !== taskId) return reply.code(400).send({ success: false, error: { code: 'TASK_ITEM_MISMATCH', message: 'Subtask does not belong to this task' } })
  const subtask = await taskItemService.update(itemId, body.updates || body)
  if (subtask.assigneeId && subtask.assigneeId !== before.assigneeId) notificationService.notifyTaskAssigned({ roomId: id, taskId, title: subtask.title, assigneeId: subtask.assigneeId, assigneeType: subtask.assigneeType, actorId: user.id, actorName: user.nickname || user.username, isSubtask: true })
  const released = []
  if (subtask.status === 'done') for (const dep of taskItemService.readyDependents(subtask.id)) released.push(await taskItemService.releaseDependent(dep.id))
  const task = await taskService.getTask(taskId)
  if (subtask.status !== before.status) notificationService.notifyTaskDone({ roomId: id, taskId, title: subtask.title, createdBy: task.createdBy, actorId: user.id, actorName: user.nickname || user.username, status: subtask.status })
  getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task }, timestamp: Date.now() })
  return reply.send({ success: true, data: { subtask, task, released } })
})

// Delete subtask via REST
app.delete('/api/rooms/:id/tasks/:taskId/subtasks/:itemId', async (request, reply) => {
  const user = (request as any).user
  const { id, taskId, itemId } = request.params as any
  const isMember = await roomService.isMember(id, user.id)
  if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
  await taskService.assertTaskInRoom(taskId, id)
  const before = taskItemService.get(itemId)
  if (before.taskId !== taskId) return reply.code(400).send({ success: false, error: { code: 'TASK_ITEM_MISMATCH', message: 'Subtask does not belong to this task' } })
  await taskItemService.delete(itemId)
  const task = await taskService.getTask(taskId)
  getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task }, timestamp: Date.now() })
  return reply.send({ success: true, data: { task } })
})

// Retry subtask via REST
app.post('/api/rooms/:id/tasks/:taskId/subtasks/:itemId/retry', async (request, reply) => {
  const user = (request as any).user
  const { id, taskId, itemId } = request.params as any
  const { reason } = request.body as any || {}
  const isMember = await roomService.isMember(id, user.id)
  if (!isMember) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
  await taskService.assertTaskInRoom(taskId, id)
  const before = taskItemService.get(itemId)
  if (before.taskId !== taskId) return reply.code(400).send({ success: false, error: { code: 'TASK_ITEM_MISMATCH', message: 'Subtask does not belong to this task' } })
  const result = await taskRetryService.retrySubtask(itemId, user.id, reason)
  getGateway()?.broadcast(id, { msgId: uuidv4(), roomId: id, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task: result.task }, timestamp: Date.now() })
  return reply.send({ success: true, data: result })
})

}
