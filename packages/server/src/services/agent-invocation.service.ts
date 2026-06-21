import { config } from '../config.js'
import { agentService } from './agent.service.js'
import { agentArtifactService } from './agent-artifact.service.js'
import { agentTaskCompletionService } from './agent-task-completion.service.js'
import { messageService } from './message.service.js'
import { remoteAgentConnectorService } from './remote-agent-connector.service.js'
import { getGateway } from '../ws/gateway.js'
import type { AgentRunContext } from './agent-runtime.service.js'

type ResponseMode = 'final_to_chat' | 'tool_only' | 'silent'

type InvokeOptions = AgentRunContext & {
  actorUserId?: string
  timeoutMs?: number
  responseMode?: ResponseMode
  metadata?: Record<string, any>
}

function broadcast(roomId: string, action: string, payload: any) {
  getGateway()?.broadcast(roomId, { action, payload })
}

export class AgentInvocationService {
  async invoke(roomId: string, agentId: string | undefined, input: string, options: InvokeOptions = {}) {
    if (!agentId) return null
    const roomAgents = await agentService.getRoomAgents(roomId)
    const agent = roomAgents.find((item) => item.id === agentId)
    if (!agent) throw { code: 'AGENT_NOT_IN_ROOM', message: 'Agent not found in room' }

    void (async () => {
      try {
        await agentService.updateAgent(agent.id, { status: 'working' } as any)
        const connector = agent.deployment === 'client' ? remoteAgentConnectorService.getConnectorSummary(agent.id) : null
        const onlineStatus = agent.deployment === 'client' && connector?.clientConnectorStatus !== 'online' && connector?.clientConnectorStatus !== 'working' ? 'offline' : 'working'
        broadcast(roomId, 'agent.status_update', { agentId: agent.id, status: 'working', onlineStatus, queued: onlineStatus === 'offline', lastActiveAt: Date.now() })
        const result = await agentService.spawnClaudeCode(roomId, agent.id, input, { ...options, timeoutMs: options.timeoutMs || config.agent.taskTimeoutMs })
        await agentArtifactService.publishDeclaredArtifacts(roomId, agent.id, input)
        const completed = options.taskId || options.subtaskId ? await agentTaskCompletionService.autoCompleteFromRun(input, result.response || '') : null
        if (completed) broadcast(roomId, 'task.changed', { action: 'update', task: completed.task })
        await agentService.updateAgent(agent.id, { status: 'active' } as any)
        broadcast(roomId, 'agent.status_update', { agentId: agent.id, status: 'active', onlineStatus: 'online', lastActiveAt: Date.now() })
        if (completed?.released?.length) {
          for (const item of completed.released) {
            if (item.assigneeType === 'agent' && item.assigneeId) await this.invoke(roomId, item.assigneeId, `前置子任务已完成，你负责的子任务已解除阻塞，请立即处理。`, { actorUserId: options.actorUserId, runSource: 'subtask', taskId: completed.task.id, subtaskId: item.id, responseMode: 'tool_only' })
          }
        }
        if (result.silent || !result.response || options.responseMode === 'silent' || options.responseMode === 'tool_only') return
        const msg = await messageService.createMessage(roomId, agent.id, agent.name, 'ai', result.response)
        broadcast(roomId, 'chat.message', msg)
      } catch (err: any) {
        await agentService.updateAgent(agentId, { status: 'error' } as any).catch(() => {})
        broadcast(roomId, 'agent.status_update', { agentId, status: 'error', onlineStatus: 'error', lastActiveAt: Date.now(), lastError: err?.message || String(err) })
        console.error(`Agent invocation ${agentId} failed:`, err)
      }
    })()
    return { accepted: true, agentId }
  }
}

export const agentInvocationService = new AgentInvocationService()
export type { ResponseMode }
