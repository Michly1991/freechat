export interface Message {
  id: string
  actorId: string
  actorName: string
  actorRole: 'human' | 'ai'
  content: string
  kind?: 'text' | 'interaction_request' | 'system' | 'agent_receipt' | 'agent_stream'
  payload?: any
  attachments?: any[]
  createdAt: number
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface Tab {
  id: string
  title?: string
  name?: string
  content: string
  icon?: string
  updated_at?: number
  updatedAt?: number
}

export type Panel = 'chat' | 'files' | 'tabs' | 'tasks'

const LOCAL_MESSAGE_CACHE_LIMIT = 100
const getMessageCacheKey = (roomId: string) => `freechat:room:${roomId}:messages`

export function mergeMessages(...groups: Message[][]): Message[] {
  const map = new Map<string, Message>()
  groups.flat().forEach((msg) => {
    if (msg?.id) map.set(msg.id, { ...map.get(msg.id), ...msg })
  })
  return Array.from(map.values())
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .slice(-LOCAL_MESSAGE_CACHE_LIMIT)
}

export function readCachedMessages(roomId: string): Message[] {
  try {
    const raw = localStorage.getItem(getMessageCacheKey(roomId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? mergeMessages(parsed) : []
  } catch {
    return []
  }
}

export function writeCachedMessages(roomId: string, messages: Message[]) {
  try {
    localStorage.setItem(getMessageCacheKey(roomId), JSON.stringify(mergeMessages(messages)))
  } catch {
    // localStorage may be full or disabled; UI should still work.
  }
}
