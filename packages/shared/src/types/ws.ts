// === WebSocket Message Types ===
export type WSMessageType = 'api_request' | 'api_response' | 'broadcast' | 'system'

export type WSEventAction =
  | 'connected'
  | 'error'
  | 'room.joined'
  | 'room.member_join'
  | 'room.member_leave'
  | 'room.online_update'
  | 'chat.message'
  | 'chat.history_result'
  | 'chat.edited'
  | 'chat.deleted'
  | 'chat.typing_update'
  | 'interaction.created'
  | 'interaction.updated'
  | 'task.list_result'
  | 'task.changed'
  | 'agent.status_update'
  | 'agent.stream.started'
  | 'agent.stream.activity'
  | 'agent.stream.completed'
  | 'agent.stream.failed'
  | 'notification.created'
  | 'notification.read'
  | 'files.updated'
  | 'tabs.updated'

export interface WSMessage<TPayload extends Record<string, any> = Record<string, any>> {
  msgId: string
  roomId: string
  type: WSMessageType
  action: WSEventAction | string
  payload: TPayload
  actor?: {
    id: string
    name: string
    role: 'human' | 'ai'
    avatar?: string
  }
  timestamp: number
}
