import db from '../storage/db.js'
import { remoteAgentConnectorService, type ConnectorAuth } from '../services/remote-agent-connector.service.js'
import { executeAppAction } from '../app-actions/executor.js'
import { handleAppUiTool } from './agent-tools.app-ui.js'
import { handleFileTool } from './agent-tools-file.js'
import { handleTabTool } from './agent-tools-tab.js'
import { handleAgentTaskTool } from './agent-tools-task.js'
import { handleAgentInteractionTabTool } from './agent-tools-interaction-tab.js'
import { handleAgentAdminTool } from './agent-tools-admin.js'
import { agentService } from '../services/agent.service.js'
import { agentStreamService } from '../services/agent-stream.service.js'
import { roomAnalyticsService } from '../services/room-analytics.service.js'
import { config } from '../config.js'
import { join } from 'path'
import { getActiveAgentStream } from '../ws/agent-stream-events.js'
import { broadcast } from './agent-tools.helpers.js'

export interface AgentToolExecutionContext {
  roomId: string
  action: string
  args: any
  agentId: string
  actorUserId: string
  actorRole?: string
  remoteAuth?: ConnectorAuth | null
}

export function actorForRemote(auth: ConnectorAuth, roomId: string, action: string, requestedActorUserId?: string, runId?: string) {
  if (requestedActorUserId && requestedActorUserId !== auth.ownerId) {
    const row = runId
      ? db.prepare('SELECT 1 FROM agent_runs WHERE id = ? AND room_id = ? AND agent_id = ? AND actor_user_id = ?').get(runId, roomId, auth.agentId, requestedActorUserId)
      : db.prepare('SELECT 1 FROM agent_runs WHERE room_id = ? AND agent_id = ? AND actor_user_id = ? AND status = ? ORDER BY started_at DESC LIMIT 1').get(roomId, auth.agentId, requestedActorUserId, 'running')
    if (row) return requestedActorUserId
  }
  if (runId) {
    const run = db.prepare('SELECT actor_user_id FROM agent_runs WHERE id = ? AND room_id = ? AND agent_id = ?').get(runId, roomId, auth.agentId) as any
    if (run?.actor_user_id) return run.actor_user_id
  }
  return auth.ownerId
}

function assertRemoteAgentInRoom(roomId: string, agentId: string) {
  const row = db.prepare('SELECT 1 FROM room_agents WHERE room_id = ? AND agent_id = ?').get(roomId, agentId)
  if (!row) throw { code: 'FORBIDDEN', message: 'Agent is not in this room' }
}

function assertActorCanEditRoom(roomId: string, actorUserId: string) {
  const member = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, actorUserId) as any
  if (!member || !['owner', 'editor'].includes(member.role)) throw { code: 'FORBIDDEN', message: 'Only project owner/editor can perform this operation' }
}

export async function executeAgentTool(ctx: AgentToolExecutionContext): Promise<any> {
  assertRemoteAgentInRoom(ctx.roomId, ctx.agentId)
  const agent = await agentService.getAgent(ctx.agentId)
  agentService.assertToolAllowed(agent, String(ctx.action || ''))
  const filesDir = join(config.workspace.root, ctx.roomId, 'files')
  const activeRunId = roomAnalyticsService.findActiveRun(ctx.roomId, agent.id)
  const activeStreamId = getActiveAgentStream(ctx.roomId, agent.id)
  const toolCallId = ctx.action ? roomAnalyticsService.createToolCall({
    roomId: ctx.roomId,
    agentId: agent.id,
    runId: activeRunId,
    streamId: activeStreamId,
    toolName: String(ctx.action),
    action: String(ctx.action),
    inputSummary: roomAnalyticsService.summarizeInput(ctx.args || {}),
  }) : null
  try {
    if (activeStreamId && ctx.action && !String(ctx.action).startsWith('tool.')) {
      const activity = agentStreamService.addActivity(activeStreamId, { text: `正在执行 ${String(ctx.action)}`, tool: String(ctx.action) })
      broadcast(ctx.roomId, 'agent.stream.activity', { id: activeStreamId, agentId: agent.id, ...activity })
    }
    let response: any
    const appUiTool = await handleAppUiTool({ action: ctx.action, args: ctx.args || {}, roomId: ctx.roomId, actorUserId: ctx.actorUserId, agentId: agent.id, actorRole: ctx.actorRole, broadcast })
    if (appUiTool.handled) response = appUiTool.response
    if (!response) {
      const fileTool = await handleFileTool({ action: ctx.action, args: ctx.args || {}, roomId: ctx.roomId, filesDir, actorUserId: ctx.actorUserId, broadcast })
      if (fileTool.handled) response = fileTool.response
    }
    if (!response) {
      const tabTool = await handleTabTool({ action: ctx.action, args: ctx.args || {}, roomId: ctx.roomId, actorUserId: ctx.actorUserId, broadcast })
      if (tabTool.handled) response = tabTool.response
    }
    if (!response) {
      const taskTool = await handleAgentTaskTool({ action: ctx.action, args: ctx.args || {}, roomId: ctx.roomId, actorUserId: ctx.actorUserId, agent, broadcast })
      if (taskTool.handled) response = taskTool.response
    }
    if (!response) {
      const interactionTabTool = await handleAgentInteractionTabTool({ action: ctx.action, args: ctx.args || {}, roomId: ctx.roomId, actorUserId: ctx.actorUserId, agent, filesDir, broadcast })
      if (interactionTabTool.handled) response = interactionTabTool.response
    }
    if (!response) {
      const adminTool = await handleAgentAdminTool({ action: ctx.action, args: ctx.args || {}, roomId: ctx.roomId, actorUserId: ctx.actorUserId, agent, assertActorCanEditRoom: () => assertActorCanEditRoom(ctx.roomId, ctx.actorUserId), broadcast })
      if (adminTool.handled) response = adminTool.response
    }
    if (!response) throw { code: 'UNKNOWN_ACTION', message: `Unknown action: ${ctx.action}` }
    if (toolCallId) roomAnalyticsService.finishToolCall(toolCallId, { status: 'succeeded' })
    return response
  } catch (err) {
    if (toolCallId) roomAnalyticsService.finishToolCall(toolCallId, { status: 'failed', errorCode: roomAnalyticsService.errorCode(err, 500), errorMessage: roomAnalyticsService.errorMessage(err) })
    throw err
  }
}

export async function executeRemoteAppCall(auth: ConnectorAuth, body: any) {
  const action = String(body?.action || body?.tool || body?.name || '').trim()
  if (!action) throw { code: 'VALIDATION_ERROR', message: 'action is required' }
  const args = body?.args || body?.params || {}
  let roomId = String(body?.roomId || args.roomId || '').trim()
  if (!roomId && body?.runId) {
    const run = db.prepare('SELECT room_id FROM agent_runs WHERE id = ? AND agent_id = ?').get(body.runId, auth.agentId) as any
    if (run?.room_id) roomId = run.room_id
  }
  const actorUserId = actorForRemote(auth, roomId, action, body?.actorUserId || args.actorUserId, body?.runId || args.runId)
  const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorUserId) as any
  if (action === 'app.call' || action === 'tool.call') {
    const result = await executeAppAction({ roomId, agentId: auth.agentId, actorUserId, actorRole: actor?.role, scopeRoomId: body?.scopeRoomId || args.scopeRoomId || args.roomId || body?.roomId }, action, args)
    if (result.handled) return result.response
  }
  if (!roomId) throw { code: 'VALIDATION_ERROR', message: 'roomId is required for room tool actions' }
  return executeAgentTool({ roomId, action, args, agentId: auth.agentId, actorUserId, actorRole: actor?.role, remoteAuth: auth })
}

export function remoteToolErrorStatus(err: any) {
  return ['TAB_NOT_FOUND', 'USER_NOT_FOUND', 'DM_NOT_FOUND', 'REQUEST_NOT_FOUND', 'ROOM_NOT_FOUND', 'AGENT_NOT_FOUND'].includes(err?.code) ? 404
    : ['INVALID_PATH', 'VALIDATION_ERROR', 'CANNOT_ADD_SELF', 'UNKNOWN_ACTION'].includes(err?.code) ? 400
      : ['AGENT_TOOL_FORBIDDEN', 'FORBIDDEN', 'NOT_ROOM_MEMBER', 'NOT_FRIENDS', 'ACTOR_REQUIRED'].includes(err?.code) ? 403
        : ['ALREADY_FRIENDS', 'REQUEST_PENDING'].includes(err?.code) ? 409
          : 500
}
