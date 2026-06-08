import { FastifyInstance } from 'fastify'
import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import { roomService } from '../services/room.service.js'
import { getGateway } from '../ws/gateway.js'

async function requireRoomRole(reply: any, roomId: string, userId: string, write = false): Promise<string | null> {
  const member: any = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId)
  if (!member) {
    reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
    return null
  }
  if (write && member.role === 'viewer') {
    reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Viewer cannot modify tabs' } })
    return null
  }
  return member.role
}


function broadcastTabsUpdated(roomId: string, payload: any) {
  getGateway()?.broadcast(roomId, {
    msgId: `tabs.updated_${Date.now()}`,
    roomId,
    type: 'broadcast',
    action: 'tabs.updated',
    payload,
    timestamp: Date.now()
  })
}

export async function registerTabRoutes(app: FastifyInstance) {
  // 获取房间的所有Tab
  app.get('/api/rooms/:roomId/tabs', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    if (!(await requireRoomRole(reply, roomId, user.id))) return reply

    const tabs = db.prepare(`
      SELECT * FROM tabs WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC
    `).all(roomId)

    return { success: true, data: { tabs } }
  })

  // 创建Tab
  app.post('/api/rooms/:roomId/tabs', async (request, reply) => {
    const { roomId } = request.params as any
    const { title, content, icon } = request.body as any
    const user = (request as any).user
    if (!(await requireRoomRole(reply, roomId, user.id, true))) return reply

    if (!String(title || '').trim()) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'title is required' } })
    }

    const tabId = `tab_${uuidv4()}`
    const now = Date.now()
    const maxOrder: any = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM tabs WHERE room_id = ?').get(roomId)

    db.prepare(`
      INSERT INTO tabs (id, room_id, title, content, icon, sort_order, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tabId, roomId, String(title).trim(), content || '', icon || '📄', (maxOrder?.max_order ?? -1) + 1, user.id, now, now)

    await roomService.updateLastActive(roomId)
    const tab = db.prepare('SELECT * FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
    broadcastTabsUpdated(roomId, { action: 'add', tab })

    return { success: true, data: { tab } }
  })

  // 更新Tab
  app.patch('/api/rooms/:roomId/tabs/:tabId', async (request, reply) => {
    const user = (request as any).user
    const { roomId, tabId } = request.params as any
    const { title, content, icon } = request.body as any
    if (!(await requireRoomRole(reply, roomId, user.id, true))) return reply

    const exists = db.prepare('SELECT id FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
    if (!exists) {
      return reply.code(404).send({ success: false, error: { code: 'TAB_NOT_FOUND', message: 'Tab not found' } })
    }

    const updates: string[] = []
    const values: any[] = []

    if (title !== undefined) {
      updates.push('title = ?')
      values.push(String(title))
    }
    if (content !== undefined) {
      updates.push('content = ?')
      values.push(String(content))
    }
    if (icon !== undefined) {
      updates.push('icon = ?')
      values.push(String(icon))
    }

    if (updates.length === 0) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } })
    }

    updates.push('updated_at = ?')
    values.push(Date.now())
    values.push(tabId, roomId)

    db.prepare(`UPDATE tabs SET ${updates.join(', ')} WHERE id = ? AND room_id = ?`).run(...values)
    await roomService.updateLastActive(roomId)

    const tab = db.prepare('SELECT * FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
    broadcastTabsUpdated(roomId, { action: 'update', tab })

    return { success: true, data: { tab } }
  })

  // 删除Tab
  app.delete('/api/rooms/:roomId/tabs/:tabId', async (request, reply) => {
    const user = (request as any).user
    const { roomId, tabId } = request.params as any
    if (!(await requireRoomRole(reply, roomId, user.id, true))) return reply

    const result = db.prepare('DELETE FROM tabs WHERE id = ? AND room_id = ?').run(tabId, roomId)
    if (result.changes === 0) {
      return reply.code(404).send({ success: false, error: { code: 'TAB_NOT_FOUND', message: 'Tab not found' } })
    }
    await roomService.updateLastActive(roomId)
    broadcastTabsUpdated(roomId, { action: 'delete', tabId })

    return { success: true }
  })

  // 调整Tab排序
  app.post('/api/rooms/:roomId/tabs/reorder', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    const { tabIds } = request.body as any
    if (!(await requireRoomRole(reply, roomId, user.id, true))) return reply

    if (!Array.isArray(tabIds)) {
      return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'tabIds must be an array' } })
    }

    const existingRows = db.prepare(`SELECT id FROM tabs WHERE room_id = ? AND id IN (${tabIds.map(() => '?').join(',') || "''"})`).all(roomId, ...tabIds) as any[]
    const existingIds = new Set(existingRows.map((r) => r.id))
    const missing = tabIds.filter((id: string) => !existingIds.has(id))
    if (missing.length > 0) {
      return reply.code(404).send({ success: false, error: { code: 'TAB_NOT_FOUND', message: `Tab not found: ${missing.join(', ')}` } })
    }

    const updateStmt = db.prepare('UPDATE tabs SET sort_order = ?, updated_at = ? WHERE id = ? AND room_id = ?')
    const now = Date.now()
    const transaction = db.transaction((ids: string[]) => {
      ids.forEach((id, index) => updateStmt.run(index, now, id, roomId))
    })

    transaction(tabIds)
    await roomService.updateLastActive(roomId)
    broadcastTabsUpdated(roomId, { action: 'reorder', tabIds })

    return { success: true }
  })
}
