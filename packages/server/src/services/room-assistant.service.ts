import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { getGateway } from '../ws/gateway.js'
import { agentService } from './agent.service.js'
import { agentInvocationService } from './agent-invocation.service.js'
import { messageService } from './message.service.js'
import { roomService } from './room.service.js'

type RequestHandoffOptions = {
  roomId: string
  targetAgentId: string
  requestedBy: string
  requestedByType: 'human' | 'agent' | 'system'
  reason?: string
  source: 'web' | 'agent_tool' | 'auto_router' | 'system'
  policy?: 'auto' | 'manual'
  wake?: boolean
  announce?: boolean
}

type HandoffOptions = RequestHandoffOptions & { requestId?: string }

function broadcast(roomId: string, action: string, payload: any) {
  getGateway()?.broadcast(roomId, { action, payload })
}

export class RoomAssistantService {
  async requestHandoff(options: RequestHandoffOptions) {
    const before = await roomService.getRoom(options.roomId) as any
    const fromAgentId = before.currentAssistantAgentId || (await agentService.getAutoAgent(options.roomId))?.id
    if (options.requestedByType === 'agent' && fromAgentId && options.requestedBy !== fromAgentId) {
      throw { code: 'NOT_CURRENT_ASSISTANT', message: 'Only current room assistant can request handoff' }
    }
    const target = (await agentService.getRoomAgents(options.roomId)).find((agent) => agent.id === options.targetAgentId)
    if (!target) throw { code: 'AGENT_NOT_IN_ROOM', message: 'Agent is not active in this room' }
    const request = this.recordRequest({ ...options, fromAgentId, policy: options.policy || 'auto' })
    broadcast(options.roomId, 'room.assistant_handoff_requested', { request, agent: target })
    if ((options.policy || 'auto') !== 'auto') return { request, accepted: false }
    return this.acceptHandoffRequest(request.id, options.requestedBy, { wake: options.wake, announce: options.announce })
  }

  async acceptHandoffRequest(requestId: string, decidedBy: string, overrides: { wake?: boolean; announce?: boolean } = {}) {
    const row = db.prepare('SELECT * FROM room_assistant_handoff_requests WHERE id = ?').get(requestId) as any
    if (!row) throw { code: 'HANDOFF_REQUEST_NOT_FOUND', message: 'Handoff request not found' }
    if (row.status !== 'pending') throw { code: 'HANDOFF_REQUEST_CLOSED', message: 'Handoff request is already closed' }
    db.prepare("UPDATE room_assistant_handoff_requests SET status = 'accepted', decision_reason = ?, decided_at = ? WHERE id = ?").run('auto accepted', Date.now(), requestId)
    const request = this.requestRowToPayload({ ...row, status: 'accepted', decision_reason: 'auto accepted', decided_at: Date.now() })
    broadcast(row.room_id, 'room.assistant_handoff_accepted', { request, decidedBy })
    return this.handoff({ roomId: row.room_id, targetAgentId: row.to_agent_id, requestedBy: row.requested_by, requestedByType: row.requested_by_type, reason: row.reason, source: row.source, wake: overrides.wake, announce: overrides.announce, requestId })
  }

  async handoff(options: HandoffOptions) {
    const { roomId, targetAgentId, requestedBy, requestedByType, reason, source } = options
    const before = await roomService.getRoom(roomId) as any
    const target = (await agentService.getRoomAgents(roomId)).find((agent) => agent.id === targetAgentId)
    if (!target) throw { code: 'AGENT_NOT_IN_ROOM', message: 'Agent is not active in this room' }

    const room = await roomService.handoffAssistant(roomId, targetAgentId, requestedBy, reason)
    const handoff = this.recordHandoff({ roomId, requestId: options.requestId, fromAgentId: before.currentAssistantAgentId, toAgentId: targetAgentId, requestedBy, requestedByType, source, reason })
    const agents = await agentService.getRoomAgents(roomId)
    const members = await roomService.getRoomMembers(roomId)

    if (options.announce !== false) {
      const msg = await messageService.createMessage(roomId, requestedBy, '系统转接', 'ai', `已转接给 ${target.name}。${reason ? `原因：${reason}` : ''}`.trim(), undefined, undefined, 'agent_receipt', { handoffId: handoff.id, handoffRequestId: options.requestId, handoffToAgentId: target.id })
      broadcast(roomId, 'chat.message', msg)
    }

    broadcast(roomId, 'room.assistant_handoff', { handoff, room, agent: target })
    broadcast(roomId, 'room.members_update', { members, agents })
    broadcast(roomId, 'room.updated', { room })

    const invocation = options.wake === false ? null : await agentInvocationService.invoke(
      roomId,
      target.id,
      `你已接手成为本房间当前协调者 Agent。转接原因：${reason || '当前协调者已切换给你'}。请结合最近上下文直接继续协调用户，给出下一步回复。`,
      { actorUserId: requestedByType === 'human' ? requestedBy : undefined, runSource: 'handoff', responseMode: 'final_to_chat', metadata: { handoffRequestId: options.requestId, handoffId: handoff.id, previousAssistantId: before.currentAssistantAgentId, currentAssistantId: target.id } }
    )
    return { room, agents, handoff, invocation }
  }

  private recordRequest(input: RequestHandoffOptions & { fromAgentId?: string; policy: string }) {
    const request = { id: `ahr_${uuidv4()}`, roomId: input.roomId, fromAgentId: input.fromAgentId, toAgentId: input.targetAgentId, requestedBy: input.requestedBy, requestedByType: input.requestedByType, source: input.source, reason: input.reason, status: 'pending', policy: input.policy, createdAt: Date.now() }
    db.prepare(`INSERT INTO room_assistant_handoff_requests (id, room_id, from_agent_id, to_agent_id, requested_by, requested_by_type, source, reason, status, policy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(request.id, request.roomId, request.fromAgentId || null, request.toAgentId, request.requestedBy, request.requestedByType, request.source, request.reason || null, request.status, request.policy, request.createdAt)
    return request
  }

  private recordHandoff(input: { roomId: string; requestId?: string; fromAgentId?: string; toAgentId: string; requestedBy: string; requestedByType: string; source: string; reason?: string }) {
    const handoff = { id: `rh_${uuidv4()}`, ...input, createdAt: Date.now() }
    try { db.prepare(`INSERT INTO room_assistant_handoffs (id, room_id, from_agent_id, to_agent_id, requested_by, requested_by_type, source, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(handoff.id, input.roomId, input.fromAgentId || null, input.toAgentId, input.requestedBy, input.requestedByType, input.source, input.reason || null, handoff.createdAt) } catch {}
    return handoff
  }

  private requestRowToPayload(row: any) {
    return { id: row.id, roomId: row.room_id, fromAgentId: row.from_agent_id || undefined, toAgentId: row.to_agent_id, requestedBy: row.requested_by, requestedByType: row.requested_by_type, source: row.source, reason: row.reason || undefined, status: row.status, policy: row.policy, decisionReason: row.decision_reason || undefined, createdAt: row.created_at, decidedAt: row.decided_at || undefined }
  }
}

export const roomAssistantService = new RoomAssistantService()
