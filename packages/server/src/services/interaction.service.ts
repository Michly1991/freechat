import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import { messageService } from './message.service.js'
import { roomService } from './room.service.js'

export type InteractionType = 'confirm' | 'choice' | 'multi_choice' | 'task_plan'
export type InteractionStatus = 'pending' | 'resolved' | 'cancelled' | 'expired'

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

export type InteractionPriority = 'normal' | 'important' | 'danger'

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
  result?: any
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

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

function rowToInteraction(row: any): InteractionRequest {
  return {
    id: row.id,
    roomId: row.room_id,
    messageId: row.message_id || undefined,
    createdBy: row.created_by,
    targetUserId: row.target_user_id || undefined,
    type: row.type,
    title: row.title,
    description: row.description || undefined,
    options: parseJson(row.options_json, []),
    status: row.status,
    result: parseJson(row.result_json, undefined),
    payload: parseJson(row.payload_json, undefined),
    priority: row.priority || 'normal',
    responsePolicy: parseJson(row.response_policy, { allowChange: false, allowCancel: true }),
    consumedBy: row.consumed_by || undefined,
    consumedAt: row.consumed_at || undefined,
    expiresAt: row.expires_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedBy: row.resolved_by || undefined,
    resolvedAt: row.resolved_at || undefined,
  }
}

export class InteractionService {
  async create(roomId: string, actor: { id: string; name: string; role: 'human' | 'ai' }, args: {
    type: InteractionType
    title: string
    description?: string
    options?: InteractionOption[]
    targetUserId?: string
    priority?: InteractionPriority
    responsePolicy?: { allowChange?: boolean; allowCancel?: boolean }
    expiresAt?: number
    payload?: any
  }): Promise<{ interaction: InteractionRequest; message: any }> {
    const title = String(args.title || '').trim()
    if (!title) throw { code: 'VALIDATION_ERROR', message: 'title is required' }
    const now = Date.now()
    const type = args.type || 'confirm'
    if (!['confirm', 'choice', 'multi_choice', 'task_plan'].includes(type)) throw { code: 'VALIDATION_ERROR', message: 'invalid interaction type' }

    let options = args.options || []
    if ((type === 'confirm' || type === 'task_plan') && options.length === 0) {
      options = type === 'task_plan'
        ? [
          { value: 'confirm', label: '确认创建', style: 'primary' },
          { value: 'cancel', label: '取消', style: 'secondary' },
        ]
        : [
          { value: 'confirm', label: '确认', style: 'primary' },
          { value: 'cancel', label: '取消', style: 'secondary' },
        ]
    }
    if ((type === 'choice' || type === 'multi_choice') && options.length === 0) {
      throw { code: 'VALIDATION_ERROR', message: 'options are required' }
    }
    const seenValues = new Set<string>()
    options = options.map((option) => ({ ...option, value: String(option.value || '').trim(), label: String(option.label || '').trim() }))
    for (const option of options) {
      if (!option.value || !option.label) throw { code: 'VALIDATION_ERROR', message: 'option value and label are required' }
      if (seenValues.has(option.value)) throw { code: 'VALIDATION_ERROR', message: `duplicate option value: ${option.value}` }
      seenValues.add(option.value)
    }
    if (args.expiresAt && args.expiresAt <= now) throw { code: 'VALIDATION_ERROR', message: 'expiresAt must be in the future' }

    const id = `ir_${uuidv4()}`
    db.prepare(`
      INSERT INTO interaction_requests (id, room_id, created_by, target_user_id, type, title, description, options_json, payload_json, status, priority, response_policy, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
    `).run(id, roomId, actor.id, args.targetUserId || null, type, title, args.description || null, JSON.stringify(options), args.payload ? JSON.stringify(args.payload) : null, args.priority || 'normal', JSON.stringify(args.responsePolicy || { allowChange: false, allowCancel: true }), args.expiresAt || null, now, now)

    let interaction = this.get(roomId, id)
    const message = await messageService.createMessage(
      roomId,
      actor.id,
      actor.name,
      actor.role,
      title,
      undefined,
      undefined,
      'interaction_request',
      { interactionId: id, interaction }
    )
    db.prepare('UPDATE interaction_requests SET message_id = ?, updated_at = ? WHERE id = ?').run(message.id, Date.now(), id)
    interaction = this.get(roomId, id)
    return { interaction, message: { ...message, payload: { interactionId: id, interaction } } }
  }

  get(roomId: string, id: string): InteractionRequest {
    const row = db.prepare('SELECT * FROM interaction_requests WHERE id = ? AND room_id = ?').get(id, roomId) as any
    if (!row) throw { code: 'INTERACTION_NOT_FOUND', message: 'Interaction request not found' }
    return rowToInteraction(row)
  }

  respond(roomId: string, id: string, userId: string, value: string | string[], inputs: Record<string, string> = {}): InteractionRequest {
    const current = this.get(roomId, id)
    if (current.status === 'pending' && current.expiresAt && current.expiresAt <= Date.now()) {
      this.expire(roomId, id)
      throw { code: 'INTERACTION_EXPIRED', message: 'Interaction has expired' }
    }
    if (current.status !== 'pending') {
      if (!(current.status === 'resolved' && current.responsePolicy?.allowChange && !current.consumedAt)) {
        throw { code: 'INTERACTION_ALREADY_RESOLVED', message: 'Interaction is not pending' }
      }
    }
    if (current.targetUserId && current.targetUserId !== userId) throw { code: 'FORBIDDEN', message: 'You cannot respond to this interaction' }
    const values = Array.isArray(value) ? value : [value]
    if (current.type !== 'multi_choice' && values.length !== 1) throw { code: 'VALIDATION_ERROR', message: 'single choice required' }
    const optionMap = new Map(current.options.map((o) => [o.value, o]))
    for (const v of values) if (!optionMap.has(v)) throw { code: 'VALIDATION_ERROR', message: `invalid option: ${v}` }
    const normalizedInputs: Record<string, string> = {}
    for (const v of values) {
      const opt = optionMap.get(v)
      if (!opt?.input?.enabled) continue
      const raw = String(inputs?.[v] || '').trim()
      if (opt.input.required && !raw) throw { code: 'VALIDATION_ERROR', message: `input required for option: ${opt.label}` }
      if (opt.input.maxLength && raw.length > opt.input.maxLength) throw { code: 'VALIDATION_ERROR', message: `input too long for option: ${opt.label}` }
      if (raw) normalizedInputs[v] = raw
    }
    const result = {
      value: current.type === 'multi_choice' ? values : values[0],
      labels: current.options.filter((o) => values.includes(o.value)).map((o) => o.label),
      inputs: normalizedInputs,
    }
    const now = Date.now()
    db.prepare(`
      UPDATE interaction_requests
      SET status = 'resolved', result_json = ?, resolved_by = ?, resolved_at = ?, updated_at = ?
      WHERE id = ? AND room_id = ?
    `).run(JSON.stringify(result), userId, now, now, id, roomId)
    return this.get(roomId, id)
  }

  list(roomId: string, filters: { status?: string; targetUserId?: string } = {}): InteractionRequest[] {
    let query = 'SELECT * FROM interaction_requests WHERE room_id = ?'
    const params: any[] = [roomId]
    if (filters.status) {
      query += ' AND status = ?'
      params.push(filters.status)
    }
    if (filters.targetUserId) {
      query += ' AND (target_user_id IS NULL OR target_user_id = ?)'
      params.push(filters.targetUserId)
    }
    query += ' ORDER BY created_at DESC'
    return (db.prepare(query).all(...params) as any[]).map(rowToInteraction)
  }

  consume(roomId: string, id: string, actorId: string): InteractionRequest {
    const current = this.get(roomId, id)
    if (current.status !== 'resolved') throw { code: 'INTERACTION_NOT_RESOLVED', message: 'Only resolved interactions can be consumed' }
    if (current.consumedAt) return current
    const now = Date.now()
    db.prepare('UPDATE interaction_requests SET consumed_by = ?, consumed_at = ?, updated_at = ? WHERE id = ? AND room_id = ?').run(actorId, now, now, id, roomId)
    return this.get(roomId, id)
  }

  expire(roomId: string, id: string): InteractionRequest {
    const current = this.get(roomId, id)
    if (current.status !== 'pending') return current
    const now = Date.now()
    db.prepare(`UPDATE interaction_requests SET status = 'expired', updated_at = ?, resolved_at = ? WHERE id = ? AND room_id = ?`).run(now, now, id, roomId)
    return this.get(roomId, id)
  }

  cancel(roomId: string, id: string, userId: string): InteractionRequest {
    const current = this.get(roomId, id)
    if (current.status !== 'pending') return current
    if (current.responsePolicy?.allowCancel === false) throw { code: 'FORBIDDEN', message: 'This interaction cannot be cancelled' }
    if (current.createdBy !== userId) throw { code: 'FORBIDDEN', message: 'Only creator can cancel this interaction' }
    const now = Date.now()
    db.prepare(`UPDATE interaction_requests SET status = 'cancelled', updated_at = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND room_id = ?`).run(now, userId, now, id, roomId)
    return this.get(roomId, id)
  }
}

export const interactionService = new InteractionService()
