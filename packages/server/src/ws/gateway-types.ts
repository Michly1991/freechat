import { WebSocket } from 'ws'

export interface ClientConnection {
  ws: WebSocket
  userId: string
  username: string
  nickname: string
  userRole?: string
  role: 'human' | 'ai'
  currentRoomId?: string
}

export type BroadcastToRoom = (roomId: string, message: any, excludeClientId?: string) => void
export type InvokeReason = 'auto' | 'mention' | 'task' | 'manual'
