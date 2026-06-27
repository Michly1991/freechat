import { readFile } from 'fs/promises'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { roomService } from '../services/room.service.js'
import { tabConfigService } from '../services/tab-config.service.js'
import { interactionService } from '../services/interaction.service.js'
import { tabFilesMapService } from '../services/tab-files-map.service.js'
import { materializeAgentCreateRequest, materializeTaskPlan } from './interactions.js'
import { assertProjectFilePathAllowed, safeRelativePath, throwTabNotFound, validateTabIds } from './agent-tools.helpers.js'

interface AgentInteractionTabToolContext {
  action: string
  args: any
  roomId: string
  actorUserId: string
  agent: any
  filesDir: string
  broadcast: (roomId: string, action: string, payload: any) => void
}

export async function handleAgentInteractionTabTool(ctx: AgentInteractionTabToolContext): Promise<{ handled: boolean; response?: any }> {
  const { action, args, roomId, actorUserId, agent, filesDir, broadcast } = ctx
  switch (action) {
        case 'interaction.create': {
          const result = await interactionService.create(roomId, { id: agent.id, name: agent.name, role: 'ai' }, {
            type: args.type || 'confirm',
            title: args.title,
            description: args.description,
            options: args.options,
            targetUserId: args.targetUserId,
            expiresAt: args.expiresAt,
          })
          broadcast(roomId, 'chat.message', result.message)
          broadcast(roomId, 'interaction.created', { interaction: result.interaction })
          return { handled: true, response: { success: true, data: result } }
        }
        case 'interaction.list': {
          const interactions = interactionService.list(roomId, { status: args.status, targetUserId: args.targetUserId })
          return { handled: true, response: { success: true, data: { interactions } } }
        }
        case 'interaction.get': {
          const interaction = interactionService.get(roomId, args.id || args.interactionId)
          return { handled: true, response: { success: true, data: { interaction } } }
        }
        case 'interaction.respond': {
          const interactionId = args.id || args.interactionId
          if (!interactionId) throw { code: 'VALIDATION_ERROR', message: 'interactionId is required' }
          const value = args.value ?? args.values
          if (value === undefined) throw { code: 'VALIDATION_ERROR', message: 'value is required' }
          const interaction = interactionService.respond(roomId, interactionId, args.userId || agent.id, value, args.inputs || {})
          broadcast(roomId, 'interaction.updated', { interaction })
          await materializeAgentCreateRequest(roomId, interaction)
          await materializeTaskPlan(roomId, interaction)
          return { handled: true, response: { success: true, data: { interaction } } }
        }
        case 'interaction.consume': {
          const interaction = interactionService.consume(roomId, args.id || args.interactionId, agent.id)
          broadcast(roomId, 'interaction.updated', { interaction })
          return { handled: true, response: { success: true, data: { interaction } } }
        }
        case 'tab-config.list': {
          const tab = await tabConfigService.getTab(roomId, String(args.tabKey || 'files'))
          return { handled: true, response: { success: true, data: { tab } } }
        }
        case 'tab-config.add-file': {
          const rel = safeRelativePath(args.path)
          assertProjectFilePathAllowed(rel)
          const tab = await tabConfigService.addFile(roomId, String(args.tabKey || 'files'), rel); await tabFilesMapService.writeRoomMap(roomId)
          broadcast(roomId, 'files.updated', { path: rel, tabKey: String(args.tabKey || 'files') })
          return { handled: true, response: { success: true, data: { tab } } }
        }
        case 'tab.files': { const content = await tabFilesMapService.writeAgentMap(roomId, agent.id); await tabFilesMapService.writeRoomMap(roomId); return { handled: true, response: { success: true, data: { content } } } }
        case 'tab-config.remove-file': {
          const rel = safeRelativePath(args.path)
          const tab = await tabConfigService.removeFile(roomId, String(args.tabKey || 'files'), rel); await tabFilesMapService.writeRoomMap(roomId)
          broadcast(roomId, 'files.updated', { path: rel, tabKey: String(args.tabKey || 'files') })
          return { handled: true, response: { success: true, data: { tab } } }
        }
        case 'tab.list': {
          const tabs = db.prepare(`
            SELECT * FROM tabs WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC
          `).all(roomId)
          return { handled: true, response: { success: true, data: { tabs } } }
        }
        case 'tab.create': {
          const title = String(args.title || '').trim()
          if (!title) throw { code: 'VALIDATION_ERROR', message: 'title is required' }
          const tabId = `tab_${uuidv4()}`
          const now = Date.now()
          const maxOrder: any = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM tabs WHERE room_id = ?').get(roomId)
          db.prepare(`
            INSERT INTO tabs (id, room_id, title, content, icon, sort_order, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(tabId, roomId, title, String(args.content || ''), args.icon || 'file', (maxOrder?.max_order ?? -1) + 1, actorUserId, now, now)
          if (args.makeDefault === true || args.default === true) {
            db.prepare(`INSERT INTO room_tab_preferences (room_id, default_tab_id, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET default_tab_id = excluded.default_tab_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(roomId, tabId, actorUserId, now)
          }
          const defaultTabId = (db.prepare('SELECT default_tab_id FROM room_tab_preferences WHERE room_id = ?').get(roomId) as any)?.default_tab_id || tabId
          await roomService.updateLastActive(roomId)
          const tab = db.prepare('SELECT * FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
          broadcast(roomId, 'tabs.updated', { action: 'add', tab, defaultTabId })
          return { handled: true, response: { success: true, data: { tab, defaultTabId } } }
        }
        case 'tab.create-from-file': {
          const title = String(args.title || '').trim()
          if (!title) throw { code: 'VALIDATION_ERROR', message: 'title is required' }
          const rel = safeRelativePath(args.path)
          const content = await readFile(join(filesDir, rel), 'utf8')
          const tabId = `tab_${uuidv4()}`
          const now = Date.now()
          const maxOrder: any = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM tabs WHERE room_id = ?').get(roomId)
          db.prepare(`
            INSERT INTO tabs (id, room_id, title, content, icon, sort_order, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(tabId, roomId, title, content, args.icon || 'file', (maxOrder?.max_order ?? -1) + 1, actorUserId, now, now)
          if (args.makeDefault === true || args.default === true) {
            db.prepare(`INSERT INTO room_tab_preferences (room_id, default_tab_id, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET default_tab_id = excluded.default_tab_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(roomId, tabId, actorUserId, now)
          }
          const defaultTabId = (db.prepare('SELECT default_tab_id FROM room_tab_preferences WHERE room_id = ?').get(roomId) as any)?.default_tab_id || tabId
          await roomService.updateLastActive(roomId)
          const tab = db.prepare('SELECT * FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
          broadcast(roomId, 'tabs.updated', { action: 'add', tab, defaultTabId })
          return { handled: true, response: { success: true, data: { tab, defaultTabId } } }
        }
        case 'tab.update': {
          const tabId = String(args.tabId || args.id || '').trim()
          if (!tabId) throw { code: 'VALIDATION_ERROR', message: 'tabId is required' }

          let content = args.content
          if (args.path) {
            const rel = safeRelativePath(args.path)
            content = await readFile(join(filesDir, rel), 'utf8')
          }

          const updates: string[] = []
          const values: any[] = []
          if (args.title !== undefined) { updates.push('title = ?'); values.push(String(args.title)) }
          if (content !== undefined) { updates.push('content = ?'); values.push(String(content)) }
          if (args.icon !== undefined) { updates.push('icon = ?'); values.push(String(args.icon)) }
          if (updates.length === 0) throw { code: 'VALIDATION_ERROR', message: 'no fields to update' }
          updates.push('updated_at = ?')
          values.push(Date.now(), tabId, roomId)
          const result = db.prepare(`UPDATE tabs SET ${updates.join(', ')} WHERE id = ? AND room_id = ?`).run(...values)
          if (result.changes === 0) throwTabNotFound(tabId)
          await roomService.updateLastActive(roomId)
          const tab = db.prepare('SELECT * FROM tabs WHERE id = ? AND room_id = ?').get(tabId, roomId)
          if (!tab) throwTabNotFound(tabId)
          broadcast(roomId, 'tabs.updated', { action: 'update', tab })
          return { handled: true, response: { success: true, data: { tab } } }
        }
        case 'tab.delete': {
          const tabId = String(args.tabId || args.id || '').trim()
          if (!tabId) throw { code: 'VALIDATION_ERROR', message: 'tabId is required' }
          const currentDefault = (db.prepare('SELECT default_tab_id FROM room_tab_preferences WHERE room_id = ?').get(roomId) as any)?.default_tab_id
          const result = db.prepare('DELETE FROM tabs WHERE id = ? AND room_id = ?').run(tabId, roomId)
          if (result.changes === 0) throwTabNotFound(tabId)
          if (currentDefault === tabId) {
            const next = db.prepare('SELECT id FROM tabs WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1').get(roomId) as any
            db.prepare(`INSERT INTO room_tab_preferences (room_id, default_tab_id, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET default_tab_id = excluded.default_tab_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(roomId, next?.id || null, actorUserId, Date.now())
          }
          await roomService.updateLastActive(roomId)
          const defaultTabId = (db.prepare('SELECT default_tab_id FROM room_tab_preferences WHERE room_id = ?').get(roomId) as any)?.default_tab_id || null
          broadcast(roomId, 'tabs.updated', { action: 'delete', tabId, defaultTabId })
          return { handled: true, response: { success: true } }
        }
        case 'tab.set-default': {
          const target = String(args.tabId || args.id || args.title || '').trim()
          if (!target) throw { code: 'VALIDATION_ERROR', message: 'tabId or title is required' }
          const tab = db.prepare('SELECT * FROM tabs WHERE room_id = ? AND (id = ? OR title = ?) LIMIT 1').get(roomId, target, target) as any
          if (!tab) throwTabNotFound(target)
          db.prepare(`INSERT INTO room_tab_preferences (room_id, default_tab_id, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(room_id) DO UPDATE SET default_tab_id = excluded.default_tab_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`).run(roomId, tab.id, actorUserId, Date.now())
          await roomService.updateLastActive(roomId)
          broadcast(roomId, 'tabs.updated', { action: 'set-default', tabId: tab.id, defaultTabId: tab.id })
          return { handled: true, response: { success: true, data: { defaultTabId: tab.id, tab } } }
        }
        case 'tab.reorder': {
          if (!Array.isArray(args.tabIds)) throw { code: 'VALIDATION_ERROR', message: 'tabIds must be an array' }
          validateTabIds(roomId, args.tabIds)
          const updateStmt = db.prepare('UPDATE tabs SET sort_order = ?, updated_at = ? WHERE id = ? AND room_id = ?')
          const now = Date.now()
          const transaction = db.transaction((ids: string[]) => {
            ids.forEach((id, index) => updateStmt.run(index, now, id, roomId))
          })
          transaction(args.tabIds)
          await roomService.updateLastActive(roomId)
          broadcast(roomId, 'tabs.updated', { action: 'reorder', tabIds: args.tabIds })
          return { handled: true, response: { success: true } }
        }
    default:
      return { handled: false }
  }
}
