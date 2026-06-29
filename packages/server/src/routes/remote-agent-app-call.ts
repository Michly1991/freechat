import db from '../storage/db.js'
import { type ConnectorAuth } from '../services/remote-agent-connector.service.js'
import { executeAppAction } from '../app-actions/executor.js'
import { executeTool } from '../app-actions/router.js'
import { canonicalizeToolAction } from '../app-actions/risk-policy.js'
import { assertRoomMember } from '../utils/room-authz.js'

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

export async function executeAgentTool(ctx: AgentToolExecutionContext): Promise<any> {
  const action = canonicalizeToolAction(ctx.action)
  const targetRoomId = String((ctx.args || {}).scopeRoomId || ctx.roomId)
  assertRemoteAgentInRoom(ctx.roomId, ctx.agentId)
  if (targetRoomId !== ctx.roomId) assertRoomMember(targetRoomId, ctx.actorUserId)
  return executeTool({
    roomId: ctx.roomId,
    scopeRoomId: targetRoomId !== ctx.roomId ? targetRoomId : undefined,
    action,
    args: ctx.args || {},
    agentId: ctx.agentId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    runId: (ctx.args || {}).runId,
    transport: ctx.remoteAuth ? 'remote-app-call' : 'legacy-agent-tools',
    recordMindmapPreview: true,
    remoteAuth: ctx.remoteAuth,
  })
}

export async function executeRemoteAppCall(auth: ConnectorAuth, body: any) {
  const action = canonicalizeToolAction(String(body?.action || body?.tool || body?.name || '').trim())
  if (!action) throw { code: 'VALIDATION_ERROR', message: 'action is required' }
  const args = body?.args || body?.params || {}
  const targetAction = action === 'app.call' || action === 'tool.call' ? canonicalizeToolAction(String(args.action || args.tool || args.name || '').trim()) : action
  let roomId = String(body?.roomId || args.roomId || '').trim()
  if (!roomId && body?.runId) {
    const run = db.prepare('SELECT room_id FROM agent_runs WHERE id = ? AND agent_id = ?').get(body.runId, auth.agentId) as any
    if (run?.room_id) roomId = run.room_id
  }
  const actorUserId = actorForRemote(auth, roomId, action, body?.actorUserId || args.actorUserId, body?.runId || args.runId)
  const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorUserId) as any
  if (!roomId && ['tool.list', 'tool.schema', 'tool.help'].includes(targetAction)) {
    const result = await executeAppAction({ roomId: '', agentId: auth.agentId, actorUserId, actorRole: actor?.role }, action, args)
    if (result.handled) return result.response
  }
  if (!roomId) throw { code: 'VALIDATION_ERROR', message: 'roomId is required for room tool actions' }
  if (action === 'app.call' || action === 'tool.call') {
    return executeAgentTool({ roomId, action, args: { ...args, runId: body?.runId || args.runId, scopeRoomId: body?.scopeRoomId || args.scopeRoomId || args.roomId }, agentId: auth.agentId, actorUserId, actorRole: actor?.role, remoteAuth: auth })
  }
  return executeAgentTool({ roomId, action, args: { ...args, runId: body?.runId || args.runId, scopeRoomId: body?.scopeRoomId || args.scopeRoomId }, agentId: auth.agentId, actorUserId, actorRole: actor?.role, remoteAuth: auth })
}

export function remoteToolErrorStatus(err: any) {
  return ['TAB_NOT_FOUND', 'USER_NOT_FOUND', 'DM_NOT_FOUND', 'REQUEST_NOT_FOUND', 'ROOM_NOT_FOUND', 'AGENT_NOT_FOUND'].includes(err?.code) ? 404
    : ['INVALID_PATH', 'VALIDATION_ERROR', 'CANNOT_ADD_SELF', 'UNKNOWN_ACTION'].includes(err?.code) ? 400
      : ['AGENT_TOOL_FORBIDDEN', 'FORBIDDEN', 'NOT_ROOM_MEMBER', 'NOT_FRIENDS', 'ACTOR_REQUIRED', 'TOOL_REQUIRES_CONFIRMATION', 'TOOL_BLOCKED'].includes(err?.code) ? 403
        : ['ALREADY_FRIENDS', 'REQUEST_PENDING'].includes(err?.code) ? 409
          : 500
}
