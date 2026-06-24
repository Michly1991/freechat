import { agentService } from '../services/agent.service.js'
import { roomAssistantService } from '../services/room-assistant.service.js'
import { workgroupService } from '../services/workgroup.service.js'

function matchAgent(items: any[], target: string) {
  const text = String(target || '').trim()
  return items.find((item: any) => item.id === text || item.name === text || item.name.includes(text) || text.includes(item.name))
}

export async function handleRoomHandoffTool(roomId: string, agent: any, actorUserId: string, args: any) {
  const target = args.agent || args.agentId || args.name
  if (!target) throw { code: 'VALIDATION_ERROR', message: 'agent is required' }
  let roomAgents = await agentService.getRoomAgents(roomId)
  let targetAgent = matchAgent(roomAgents, target)

  if (!targetAgent) {
    const workgroup = workgroupService.getRoomWorkgroup(roomId)
    const workgroupAgent = matchAgent(workgroupService.listAgents(workgroup.id), target)
    if (!workgroupAgent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found in room or current workgroup' }
    await agentService.addAgentToRoom(roomId, workgroupAgent.id, actorUserId, { roomRole: 'specialist', autoEnabled: false })
    await agentService.refreshRoomAgentContext(roomId).catch(() => {})
    roomAgents = await agentService.getRoomAgents(roomId)
    targetAgent = matchAgent(roomAgents, workgroupAgent.id)
  }

  if (!targetAgent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found in room' }
  return { success: true, data: await roomAssistantService.requestHandoff({ roomId, targetAgentId: targetAgent.id, requestedBy: agent.id, requestedByType: 'agent', reason: args.reason || '', source: 'agent_tool', policy: 'auto', wake: true }) }
}
