import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { getGateway } from '../ws/gateway.js'
import { agentService } from './agent.service.js'
import { agentInvocationService } from './agent-invocation.service.js'
import { messageService } from './message.service.js'
import { roomService } from './room.service.js'

type HandoffOptions = {
  roomId: string
  targetAgentId: string
  requestedBy: string
  requestedByType: 'human' | 'agent' | 'system'
  reason?: string
  source: 'web' | 'agent_tool' | 'auto_router' | 'system'
  wake?: boolean
  announce?: boolean
}

function broadcast(roomId: string, action: string, payload: any) {
  getGateway()?.broadcast(roomId, { action, payload })
}

export class RoomAssistantService {
  async handoff(options: HandoffOptions) {
    const { roomId, targetAgentId, requestedBy, requestedByType, reason, source } = options
    const before = await roomService.getRoom(roomId) as any
    const target = (await agentService.getRoomAgents(roomId)).find((agent) => agent.id === targetAgentId)
    if (!target) throw { code: 'AGENT_NOT_IN_ROOM', message: 'Agent is not active in this room' }

    const room = await roomService.handoffAssistant(roomId, targetAgentId, requestedBy, reason)
    const handoff = this.recordHandoff({ roomId, fromAgentId: before.currentAssistantAgentId, toAgentId: targetAgentId, requestedBy, requestedByType, source, reason })
    const agents = await agentService.getRoomAgents(roomId)
    const members = await roomService.getRoomMembers(roomId)

    if (options.announce !== false) {
      const actor = requestedByType === 'agent' ? requestedBy : target.id
      const actorName = requestedByType === 'agent' ? '系统转接' : '系统'
      const msg = await messageService.createMessage(roomId, actor, actorName, 'ai', `已转接给 ${target.name}。${reason ? `原因：${reason}` : ''}`.trim(), undefined, undefined, 'agent_receipt', { handoffId: handoff.id, handoffToAgentId: target.id })
      broadcast(roomId, 'chat.message', msg)
    }

    broadcast(roomId, 'room.assistant_handoff', { handoff, room, agent: target })
    broadcast(roomId, 'room.members_update', { members, agents })
    broadcast(roomId, 'room.updated', { room })

    const invocation = options.wake === false ? null : await agentInvocationService.invoke(
      roomId,
      target.id,
      `你已接手成为本房间当前接待 Agent。转接原因：${reason || '当前接待已切换给你'}。请结合最近上下文直接继续接待用户，给出下一步回复。`,
      { actorUserId: requestedByType === 'human' ? requestedBy : undefined, runSource: 'handoff', responseMode: 'final_to_chat', metadata: { handoffId: handoff.id, previousAssistantId: before.currentAssistantAgentId, currentAssistantId: target.id } }
    )
    return { room, agents, handoff, invocation }
  }

  private recordHandoff(input: { roomId: string; fromAgentId?: string; toAgentId: string; requestedBy: string; requestedByType: string; source: string; reason?: string }) {
    const handoff = { id: `rh_${uuidv4()}`, ...input, createdAt: Date.now() }
    try {
      db.prepare(`INSERT INTO room_assistant_handoffs (id, room_id, from_agent_id, to_agent_id, requested_by, requested_by_type, source, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(handoff.id, input.roomId, input.fromAgentId || null, input.toAgentId, input.requestedBy, input.requestedByType, input.source, input.reason || null, handoff.createdAt)
    } catch {}
    return handoff
  }
}

export const roomAssistantService = new RoomAssistantService()
