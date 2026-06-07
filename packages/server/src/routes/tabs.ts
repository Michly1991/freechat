import { FastifyInstance } from 'fastify'
import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'

export async function registerTabRoutes(app: FastifyInstance) {
  // 获取房间的所有Tab
  app.get('/api/rooms/:roomId/tabs', async (request, reply) => {
    const { roomId } = request.params as any
    
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

    const tabId = `tab_${uuidv4()}`
    const now = Date.now()

    db.prepare(`
      INSERT INTO tabs (id, room_id, title, content, icon, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(tabId, roomId, title, content || '', icon || '📄', user.id, now, now)

    const tab = db.prepare('SELECT * FROM tabs WHERE id = ?').get(tabId)

    return { success: true, data: { tab } }
  })

  // 更新Tab
  app.patch('/api/rooms/:roomId/tabs/:tabId', async (request, reply) => {
    const { roomId, tabId } = request.params as any
    const { title, content, icon } = request.body as any

    const updates: string[] = []
    const values: any[] = []

    if (title !== undefined) {
      updates.push('title = ?')
      values.push(title)
    }
    if (content !== undefined) {
      updates.push('content = ?')
      values.push(content)
    }
    if (icon !== undefined) {
      updates.push('icon = ?')
      values.push(icon)
    }

    if (updates.length === 0) {
      return reply.code(400).send({ success: false, error: 'No fields to update' })
    }

    updates.push('updated_at = ?')
    values.push(Date.now())
    values.push(tabId)

    db.prepare(`UPDATE tabs SET ${updates.join(', ')} WHERE id = ?`).run(...values)

    const tab = db.prepare('SELECT * FROM tabs WHERE id = ?').get(tabId)

    return { success: true, data: { tab } }
  })

  // 删除Tab
  app.delete('/api/rooms/:roomId/tabs/:tabId', async (request, reply) => {
    const { tabId } = request.params as any

    db.prepare('DELETE FROM tabs WHERE id = ?').run(tabId)

    return { success: true }
  })

  // 调整Tab排序
  app.post('/api/rooms/:roomId/tabs/reorder', async (request, reply) => {
    const { roomId } = request.params as any
    const { tabIds } = request.body as any

    if (!Array.isArray(tabIds)) {
      return reply.code(400).send({ success: false, error: 'tabIds must be an array' })
    }

    const updateStmt = db.prepare('UPDATE tabs SET sort_order = ? WHERE id = ? AND room_id = ?')
    
    const transaction = db.transaction((ids: string[]) => {
      ids.forEach((id, index) => {
        updateStmt.run(index, id, roomId)
      })
    })

    transaction(tabIds)

    return { success: true }
  })
}
