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

function getDefaultTabId(roomId: string): string | null {
  const pref = db.prepare('SELECT default_tab_id FROM room_tab_preferences WHERE room_id = ?').get(roomId) as any
  if (!pref?.default_tab_id) return null
  const exists = db.prepare('SELECT id FROM tabs WHERE id = ? AND room_id = ?').get(pref.default_tab_id, roomId)
  return exists ? pref.default_tab_id : null
}

function setDefaultTab(roomId: string, tabId: string | null, userId: string) {
  const now = Date.now()
  db.prepare(`
    INSERT INTO room_tab_preferences (room_id, default_tab_id, updated_by, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(room_id) DO UPDATE SET default_tab_id = excluded.default_tab_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).run(roomId, tabId, userId, now)
}

function ensureDefaultTab(roomId: string, userId: string): string | null {
  const current = getDefaultTabId(roomId)
  if (current) return current
  const first = db.prepare('SELECT id FROM tabs WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1').get(roomId) as any
  if (first?.id) setDefaultTab(roomId, first.id, userId)
  return first?.id || null
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
  app.get('/api/rooms/:roomId/tabs', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    if (!(await requireRoomRole(reply, roomId, user.id))) return reply

    const tabs = db.prepare('SELECT * FROM tabs WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC').all(roomId)
    const defaultTabId = ensureDefaultTab(roomId, user.id)
    return { success: true, data: { tabs, defaultTabId } }
  })

  app.post('/api/rooms/:roomId/tabs', async (request, reply) => {
    const { roomId } = request.params as any
    const { title, content, icon, makeDefault } = request.body as any
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
    `).run(tabId, roomId, String(title).trim(), content || '', icon || 'file', (maxOrder?.max_order ?? -1) + 1, user.id, now, now)

    if (makeDefault === true) setDefaultTab(roomId, tabId, user.id)
    const defaultTabId = ensureDefaultTab(roomId, user.id)
    await roomService.updateLastActive(roomId)
    const tab = db.prepare('SELECT * FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
    broadcastTabsUpdated(roomId, { action: 'add', tab, defaultTabId })
    return { success: true, data: { tab, defaultTabId } }
  })

  app.patch('/api/rooms/:roomId/tabs/:tabId', async (request, reply) => {
    const user = (request as any).user
    const { roomId, tabId } = request.params as any
    const { title, content, icon } = request.body as any
    if (!(await requireRoomRole(reply, roomId, user.id, true))) return reply

    const exists = db.prepare('SELECT id FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
    if (!exists) return reply.code(404).send({ success: false, error: { code: 'TAB_NOT_FOUND', message: 'Tab not found' } })

    const updates: string[] = []
    const values: any[] = []
    if (title !== undefined) { updates.push('title = ?'); values.push(String(title)) }
    if (content !== undefined) { updates.push('content = ?'); values.push(String(content)) }
    if (icon !== undefined) { updates.push('icon = ?'); values.push(String(icon)) }
    if (updates.length === 0) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } })

    updates.push('updated_at = ?')
    values.push(Date.now(), tabId, roomId)
    db.prepare(`UPDATE tabs SET ${updates.join(', ')} WHERE id = ? AND room_id = ?`).run(...values)
    await roomService.updateLastActive(roomId)
    const tab = db.prepare('SELECT * FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
    const defaultTabId = getDefaultTabId(roomId)
    broadcastTabsUpdated(roomId, { action: 'update', tab, defaultTabId })
    return { success: true, data: { tab, defaultTabId } }
  })

  app.delete('/api/rooms/:roomId/tabs/:tabId', async (request, reply) => {
    const user = (request as any).user
    const { roomId, tabId } = request.params as any
    if (!(await requireRoomRole(reply, roomId, user.id, true))) return reply

    const currentDefault = getDefaultTabId(roomId)
    const result = db.prepare('DELETE FROM tabs WHERE id = ? AND room_id = ?').run(tabId, roomId)
    if (result.changes === 0) return reply.code(404).send({ success: false, error: { code: 'TAB_NOT_FOUND', message: 'Tab not found' } })
    if (currentDefault === tabId) {
      const next = db.prepare('SELECT id FROM tabs WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1').get(roomId) as any
      setDefaultTab(roomId, next?.id || null, user.id)
    }
    await roomService.updateLastActive(roomId)
    broadcastTabsUpdated(roomId, { action: 'delete', tabId, defaultTabId: getDefaultTabId(roomId) })
    return { success: true }
  })

  app.post('/api/rooms/:roomId/tabs/:tabId/default', async (request, reply) => {
    const user = (request as any).user
    const { roomId, tabId } = request.params as any
    if (!(await requireRoomRole(reply, roomId, user.id, true))) return reply
    const exists = db.prepare('SELECT id FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
    if (!exists) return reply.code(404).send({ success: false, error: { code: 'TAB_NOT_FOUND', message: 'Tab not found' } })
    setDefaultTab(roomId, tabId, user.id)
    await roomService.updateLastActive(roomId)
    broadcastTabsUpdated(roomId, { action: 'set-default', tabId, defaultTabId: tabId })
    return { success: true, data: { defaultTabId: tabId } }
  })

  app.post('/api/rooms/:roomId/tabs/reorder', async (request, reply) => {
    const user = (request as any).user
    const { roomId } = request.params as any
    const { tabIds } = request.body as any
    if (!(await requireRoomRole(reply, roomId, user.id, true))) return reply
    if (!Array.isArray(tabIds)) return reply.code(400).send({ success: false, error: { code: 'VALIDATION_ERROR', message: 'tabIds must be an array' } })

    const existingRows = db.prepare(`SELECT id FROM tabs WHERE room_id = ? AND id IN (${tabIds.map(() => '?').join(',') || "''"})`).all(roomId, ...tabIds) as any[]
    const existingIds = new Set(existingRows.map((r) => r.id))
    const missing = tabIds.filter((id: string) => !existingIds.has(id))
    if (missing.length > 0) return reply.code(404).send({ success: false, error: { code: 'TAB_NOT_FOUND', message: `Tab not found: ${missing.join(', ')}` } })

    const updateStmt = db.prepare('UPDATE tabs SET sort_order = ?, updated_at = ? WHERE id = ? AND room_id = ?')
    const now = Date.now()
    db.transaction((ids: string[]) => ids.forEach((id, index) => updateStmt.run(index, now, id, roomId)))(tabIds)
    await roomService.updateLastActive(roomId)
    broadcastTabsUpdated(roomId, { action: 'reorder', tabIds, defaultTabId: getDefaultTabId(roomId) })
    return { success: true }
  })
}
