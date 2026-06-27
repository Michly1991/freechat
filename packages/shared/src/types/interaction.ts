// === Interaction Types ===
export type InteractionType = 'confirm' | 'choice' | 'multi_choice' | 'task_plan'
export type InteractionStatus = 'pending' | 'resolved' | 'cancelled' | 'expired'
export type InteractionPriority = 'normal' | 'important' | 'danger'

export interface InteractionOption {
  value: string
  label: string
  style?: 'primary' | 'secondary' | 'danger'
  input?: {
    enabled: boolean
    required?: boolean
    placeholder?: string
    multiline?: boolean
    maxLength?: number
  }
}

export interface InteractionRequest {
  id: string
  roomId: string
  messageId?: string
  createdBy: string
  targetUserId?: string
  type: InteractionType
  title: string
  description?: string
  options: InteractionOption[]
  status: InteractionStatus
  result?: {
    value: string | string[]
    labels: string[]
    inputs?: Record<string, string>
  }
  payload?: any
  priority?: InteractionPriority
  responsePolicy?: { allowChange?: boolean; allowCancel?: boolean }
  consumedBy?: string
  consumedAt?: number
  expiresAt?: number
  createdAt: number
  updatedAt: number
  resolvedBy?: string
  resolvedAt?: number
}
