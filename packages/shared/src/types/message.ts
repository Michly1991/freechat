// === Message Types ===
export interface MessageAttachment {
  id: string
  ref: string
  roomId: string
  folderId: string
  name: string
  relativePath: string
  mimeType?: string
  size: number
  source: string
  messageId?: string
  createdAt: number
}

export interface Message {
  id: string
  roomId: string
  actorId: string
  actorName: string
  actorRole: 'human' | 'ai'
  content: string
  kind?: 'text' | 'interaction_request' | 'system' | 'agent_receipt' | 'agent_stream'
  payload?: Record<string, any>
  attachments?: MessageAttachment[]
  mentions?: Mention[]
  replyTo?: string
  editedAt?: number
  deleted: boolean
  createdAt: number
}

export interface Mention {
  id: string
  name: string
  role: 'human' | 'ai' | 'file'
  type?: 'user' | 'agent' | 'file'
  path?: string
  mimeType?: string
  size?: number
}
