import { FastifyInstance } from 'fastify'
import { join } from 'path'
import db from '../storage/db.js'
import { config } from '../config.js'
import { verifyAgentToolToken } from '../agent-tool-token.js'
import { agentService } from '../services/agent.service.js'
import { agentStreamService } from '../services/agent-stream.service.js'
import { roomAnalyticsService } from '../services/room-analytics.service.js'
import { remoteAgentConnectorService } from '../services/remote-agent-connector.service.js'
import { getActiveAgentStream } from '../ws/agent-stream-events.js'
import { handleAppUiTool } from './agent-tools.app-ui.js'
import { handleFileTool } from './agent-tools-file.js'
import { handleTabTool } from './agent-tools-tab.js'
import { handleAgentTaskTool } from './agent-tools-task.js'
import { handleAgentInteractionTabTool } from './agent-tools-interaction-tab.js'
import { handleAgentAdminTool } from './agent-tools-admin.js'
import { broadcast } from './agent-tools.helpers.js'
import { isPersonalTool } from './agent-tools-auth.js'
export async function registerAgentToolRoutes(app: FastifyInstance) {
  app.post('/api/agent-tools/:roomId', async (request, reply) => {
    const { roomId } = request.params as any
    const auth = request.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    let verified = verifyAgentToolToken(roomId, token)
    let remoteAuth: any = null
    if (!verified.ok || !verified.agentId) {
      remoteAuth = await remoteAgentConnectorService.authenticateBearer(request.headers.authorization)
      if (remoteAuth) verified = { ok: true, agentId: remoteAuth.agentId, actorUserId: remoteAuth.ownerId }
    }
    if (!verified.ok || !verified.agentId) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid agent tool token' } })
    }
    const roomAgent = db.prepare('SELECT 1 FROM room_agents WHERE room_id = ? AND agent_id = ?').get(roomId, verified.agentId)
    if (!roomAgent) return reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Agent is not in this room' } })
    const agent = await agentService.getAgent(verified.agentId)
    const body = request.body as any
    const action = String(body.action || body.tool || '')
    const actorUserId = verified.actorUserId || (!isPersonalTool(action) ? ((db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(roomId) as any)?.created_by || agent.ownerId || agent.id) : undefined)
    if (isPersonalTool(action) && !verified.actorUserId) {
      return reply.code(403).send({ success: false, error: { code: 'ACTOR_REQUIRED', message: 'This tool requires a user-scoped actorUserId token' } })
    }
    const assertActorCanEditRoom = () => {
      const member = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, actorUserId) as any
      if (!member || !['owner', 'editor'].includes(member.role)) throw { code: 'FORBIDDEN', message: 'Only project owner/editor can perform this operation' }
    }
    const args = body.args || {}
    const filesDir = join(config.workspace.root, roomId, 'files')
    const activeRunId = roomAnalyticsService.findActiveRun(roomId, agent.id)
    const activeStreamId = getActiveAgentStream(roomId, agent.id)
    let toolCallId: string | null = null
    let toolError: any = null
    if (action) {
      toolCallId = roomAnalyticsService.createToolCall({
        roomId,
        agentId: agent.id,
        runId: activeRunId,
        streamId: activeStreamId,
        toolName: String(action),
        action: String(action),
        inputSummary: roomAnalyticsService.summarizeInput(args),
      })
      reply.raw.once('finish', () => {
        if (!toolCallId) return
        const failed = reply.statusCode >= 400
        roomAnalyticsService.finishToolCall(toolCallId, failed
          ? { status: 'failed', errorCode: roomAnalyticsService.errorCode(toolError, reply.statusCode), errorMessage: roomAnalyticsService.errorMessage(toolError || `HTTP ${reply.statusCode}`) }
          : { status: 'succeeded' })
      })
    }

    try {
      agentService.assertToolAllowed(agent, String(action || ''))
      if (activeStreamId && action && !String(action).startsWith('tool.')) {
        const activity = agentStreamService.addActivity(activeStreamId, { text: `正在执行 ${String(action)}`, tool: String(action) })
        broadcast(roomId, 'agent.stream.activity', { id: activeStreamId, agentId: agent.id, ...activity })
      }
      const appUiTool = await handleAppUiTool({ action: String(action || ''), args, roomId, actorUserId, agentId: agent.id, broadcast })
      if (appUiTool.handled) {
        return appUiTool.response
      }
      const fileTool = await handleFileTool({ action: String(action || ''), args, roomId, filesDir, actorUserId, broadcast })
      if (fileTool.handled) {
        return fileTool.response
      }
      const tabTool = await handleTabTool({ action: String(action || ''), args, roomId, actorUserId, broadcast })
      if (tabTool.handled) {
        return tabTool.response
      }
      const taskTool = await handleAgentTaskTool({ action: String(action || ''), args, roomId, actorUserId, agent, broadcast })
      if (taskTool.handled) {
        return taskTool.response
      }
      const interactionTabTool = await handleAgentInteractionTabTool({ action: String(action || ''), args, roomId, actorUserId, agent, filesDir, broadcast })
      if (interactionTabTool.handled) {
        return interactionTabTool.response
      }
      const adminTool = await handleAgentAdminTool({ action: String(action || ''), args, roomId, actorUserId, agent, assertActorCanEditRoom, broadcast })
      if (adminTool.handled) {
        return adminTool.response
      }
      switch (action) {
        default:
          toolError = { code: 'UNKNOWN_ACTION', message: `Unknown action: ${action}` }
          return reply.code(400).send({ success: false, error: toolError })
      }
    } catch (err: any) {
      const status = ['TAB_NOT_FOUND', 'USER_NOT_FOUND', 'DM_NOT_FOUND', 'REQUEST_NOT_FOUND', 'ROOM_NOT_FOUND', 'AGENT_NOT_FOUND'].includes(err.code) ? 404
        : ['INVALID_PATH', 'VALIDATION_ERROR', 'CANNOT_ADD_SELF'].includes(err.code) ? 400
          : ['AGENT_TOOL_FORBIDDEN', 'FORBIDDEN', 'NOT_ROOM_MEMBER', 'NOT_FRIENDS'].includes(err.code) ? 403
            : ['ALREADY_FRIENDS', 'REQUEST_PENDING'].includes(err.code) ? 409
              : 500
      toolError = err
      return reply.code(status).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })
}
