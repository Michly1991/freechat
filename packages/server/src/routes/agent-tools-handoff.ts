import { agentService } from '../services/agent.service.js'
import { roomAssistantService } from '../services/room-assistant.service.js'

export async function handleRoomHandoffTool(roomId: string, agent: any, actorUserId: string, args: any) {
  const target = args.agent || args.agentId || args.name
  if (!target) throw { code: 'VALIDATION_ERROR', message: 'agent is required' }
  const roomAgents = await agentService.getRoomAgents(roomId)
  const targetAgent = roomAgents.find((item: any) => item.id === target || item.name === target || item.name.includes(target) || String(target).includes(item.name))
  if (!targetAgent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found in room' }
  return { success: true, data: await roomAssistantService.handoff({ roomId, targetAgentId: targetAgent.id, requestedBy: agent.id, requestedByType: 'agent', reason: args.reason || '', source: 'agent_tool', wake: true }) }
}
