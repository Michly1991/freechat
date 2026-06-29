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
  kind?: 'text' | 'interaction_request' | 'system' | 'system_notice' | 'agent_receipt' | 'agent_stream' | 'artifact_preview'
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
