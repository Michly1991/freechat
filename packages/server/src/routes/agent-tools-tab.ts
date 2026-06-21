import db from '../storage/db.js'
import { roomService } from '../services/room.service.js'

interface TabToolContext {
  action: string
  args: any
  roomId: string
  actorUserId: string
  broadcast: (roomId: string, action: string, payload: any) => void
}

function findTab(roomId: string, target: string) {
  const key = String(target || '').trim()
  if (!key) return null
  return db.prepare('SELECT * FROM tabs WHERE room_id = ? AND (id = ? OR title = ?) LIMIT 1').get(roomId, key, key) as any
}

function snippet(text: string, query: string) {
  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return ''
  const start = Math.max(0, index - 80)
  const end = Math.min(text.length, index + query.length + 120)
  return text.slice(start, end)
}

function patchContent(content: string, args: any) {
  if (Array.isArray(args.operations)) {
    return args.operations.reduce((current: string, op: any) => patchContent(current, op), content)
  }
  const type = String(args.type || 'replace')
  if (type === 'append') return content + String(args.content || '')
  if (type === 'prepend') return String(args.content || '') + content
  const find = String(args.find || args.oldText || '')
  if (!find) throw { code: 'VALIDATION_ERROR', message: 'find/oldText is required for replace patch' }
  if (!content.includes(find)) throw { code: 'TAB_PATCH_TARGET_NOT_FOUND', message: 'Patch target text not found in tab content' }
  return content.replace(find, String(args.replace ?? args.newText ?? ''))
}

export async function handleTabTool(ctx: TabToolContext): Promise<{ handled: boolean; response?: any }> {
  const { action, args, roomId, actorUserId, broadcast } = ctx
  switch (action) {
    case 'tab.get':
    case 'tab.read': {
      const tab = findTab(roomId, args.tabId || args.id || args.title || args.target)
      if (!tab) throw { code: 'TAB_NOT_FOUND', message: 'Tab not found' }
      const defaultTabId = (db.prepare('SELECT default_tab_id FROM room_tab_preferences WHERE room_id = ?').get(roomId) as any)?.default_tab_id || null
      return { handled: true, response: { success: true, data: { tab: { ...tab, isDefault: defaultTabId === tab.id } } } }
    }
    case 'tab.search': {
      const query = String(args.query || args.q || '').trim()
      if (!query) throw { code: 'VALIDATION_ERROR', message: 'query is required' }
      const tabs = db.prepare('SELECT id, title, content, icon, sort_order, updated_at FROM tabs WHERE room_id = ? ORDER BY sort_order ASC, created_at ASC').all(roomId) as any[]
      const matches = tabs.filter((tab) => String(tab.title || '').includes(query) || String(tab.content || '').toLowerCase().includes(query.toLowerCase()))
        .slice(0, 30)
        .map((tab) => ({ id: tab.id, title: tab.title, icon: tab.icon, sortOrder: tab.sort_order, updatedAt: tab.updated_at, snippet: snippet(String(tab.content || ''), query) }))
      return { handled: true, response: { success: true, data: { query, matches } } }
    }
    case 'tab.patch': {
      const tab = findTab(roomId, args.tabId || args.id || args.title || args.target)
      if (!tab) throw { code: 'TAB_NOT_FOUND', message: 'Tab not found' }
      const content = patchContent(String(tab.content || ''), args)
      const now = Date.now()
      db.prepare('UPDATE tabs SET content = ?, updated_at = ? WHERE id = ? AND room_id = ?').run(content, now, tab.id, roomId)
      await roomService.updateLastActive(roomId)
      const next = db.prepare('SELECT * FROM tabs WHERE id = ? AND room_id = ?').get(tab.id, roomId)
      broadcast(roomId, 'tabs.updated', { action: 'update', tab: next })
      return { handled: true, response: { success: true, data: { tab: next } } }
    }
    case 'tab.open':
    case 'tab.focus': {
      const tab = findTab(roomId, args.tabId || args.id || args.title || args.target)
      if (!tab) throw { code: 'TAB_NOT_FOUND', message: 'Tab not found' }
      const payload = { tabId: tab.id, title: tab.title, anchor: args.anchor || args.hash || undefined, requestedBy: actorUserId }
      broadcast(roomId, 'tab.open', payload)
      return { handled: true, response: { success: true, data: payload } }
    }
    case 'tab.action': {
      const tab = findTab(roomId, args.tabId || args.id || args.title || args.target)
      if (!tab) throw { code: 'TAB_NOT_FOUND', message: 'Tab not found' }
      const type = String(args.type || args.action || '').trim()
      if (!['open', 'scrollTo', 'highlight'].includes(type)) throw { code: 'TAB_ACTION_FORBIDDEN', message: 'Only open/scrollTo/highlight page actions are supported' }
      const payload = { tabId: tab.id, title: tab.title, type, anchor: args.anchor, selector: args.selector, elementId: args.elementId || args.id, requestedBy: actorUserId }
      broadcast(roomId, 'tab.action', payload)
      return { handled: true, response: { success: true, data: payload } }
    }
    default:
      return { handled: false }
  }
}
