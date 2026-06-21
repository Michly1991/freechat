import { agentService } from '../services/agent.service.js'
import { messageService } from '../services/message.service.js'
import { roomService } from '../services/room.service.js'
import { broadcast, invokeAssignedAgent } from './agent-tools.helpers.js'

export async function handleRoomHandoffTool(roomId: string, agent: any, actorUserId: string, args: any) {
  const target = args.agent || args.agentId || args.name
  if (!target) throw { code: 'VALIDATION_ERROR', message: 'agent is required' }
  const roomAgents = await agentService.getRoomAgents(roomId)
  const targetAgent = roomAgents.find((item: any) => item.id === target || item.name === target || item.name.includes(target) || String(target).includes(item.name))
  if (!targetAgent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found in room' }
  const room = await roomService.handoffAssistant(roomId, targetAgent.id, agent.id, args.reason || '')
  const agents = await agentService.getRoomAgents(roomId)
  const msg = await messageService.createMessage(roomId, agent.id, agent.name, 'ai', `已转接给 ${targetAgent.name}。${args.reason ? `原因：${args.reason}` : ''}`.trim(), undefined, undefined, 'agent_receipt', { handoffToAgentId: targetAgent.id })
  broadcast(roomId, 'chat.message', msg)
  broadcast(roomId, 'room.members_update', { members: await roomService.getRoomMembers(roomId), agents })
  broadcast(roomId, 'room.updated', { room })
  void invokeAssignedAgent(roomId, targetAgent.id, actorUserId, `你已接手成为本房间当前接待 Agent。转接原因：${args.reason || '用户/上一位 Agent 要求转接'}。请直接继续接待用户，不要再重复解释转接流程。`, actorUserId)
  return { success: true, data: { room, agent: targetAgent } }
}
