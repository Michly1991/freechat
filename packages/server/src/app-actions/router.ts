import db from '../storage/db.js'
import { messageService as defaultMessageService } from '../services/message.service.js'
import { agentService } from '../services/agent.service.js'
import { agentStreamService } from '../services/agent-stream.service.js'
import { roomAnalyticsService } from '../services/room-analytics.service.js'
import { getActiveAgentStream } from '../ws/agent-stream-events.js'
import { broadcast } from '../routes/agent-tools.helpers.js'
import { executeLocalAgentTool } from '../routes/agent-tools-dispatch.js'
import { canonicalizeToolAction, riskForAction, assertRiskAllowed } from './risk-policy.js'
import { getAppAction, runRegisteredAppAction } from './registry.js'
import type { ToolExecutionContext, ToolExecutionOptions } from './types.js'

function responseSummary(response: any) {
  if (!response) return null
  if (response?.success === false) return roomAnalyticsService.summarizeOutput(response.error || response)
  return roomAnalyticsService.summarizeOutput(response?.message || response?.data || response)
}

function activityTitle(action: string) {
  const meta = getAppAction(action)
  return meta?.title || action
}

export async function executeTool(ctx: ToolExecutionContext, options: ToolExecutionOptions = {}): Promise<any> {
  const action = canonicalizeToolAction(ctx.action)
  if (!action) throw { code: 'VALIDATION_ERROR', message: 'action is required' }
  const normalizedCtx = { ...ctx, action, args: ctx.args || {} }
  const risk = riskForAction(action)
  assertRiskAllowed(normalizedCtx, risk)

  const agent = await agentService.getAgent(normalizedCtx.agentId)
  agentService.assertToolAllowed(agent, action)

  const targetRoomId = String(normalizedCtx.scopeRoomId || normalizedCtx.roomId)
  const activeRunId = normalizedCtx.runId || roomAnalyticsService.findActiveRun(normalizedCtx.roomId, agent.id)
  const activeStreamId = normalizedCtx.streamId || getActiveAgentStream(normalizedCtx.roomId, agent.id)
  const shouldAudit = options.audit !== false
  const toolCallId = shouldAudit ? roomAnalyticsService.createToolCall({
    roomId: targetRoomId,
    agentId: agent.id,
    runId: activeRunId,
    streamId: activeStreamId,
    toolName: action,
    action,
    inputSummary: roomAnalyticsService.summarizeInput(normalizedCtx.args || {}),
  }) : null

  const emitActivity = (tool: string) => {
    normalizedCtx.emitActivity?.(tool)
    if (!activeStreamId || String(tool).startsWith('tool.')) return
    const activity = agentStreamService.addActivity(activeStreamId, { text: `正在执行 ${activityTitle(tool)}`, tool })
    broadcast(normalizedCtx.roomId, 'agent.stream.activity', { id: activeStreamId, agentId: agent.id, ...activity })
  }

  try {
    emitActivity(action)
    const registered = await runRegisteredAppAction(normalizedCtx, normalizedCtx.args || {})
    const response = registered.handled
      ? registered.response
      : await executeLocalAgentTool({
        roomId: targetRoomId,
        action,
        args: normalizedCtx.args || {},
        agentId: agent.id,
        actorUserId: normalizedCtx.actorUserId,
        actorRole: normalizedCtx.actorRole,
        recordMindmapPreview: normalizedCtx.recordMindmapPreview,
      }, { db: options.db || db, messageService: options.messageService || defaultMessageService })
    if (toolCallId) roomAnalyticsService.finishToolCall(toolCallId, { status: 'succeeded', outputSummary: responseSummary(response) })
    return response
  } catch (err: any) {
    if (toolCallId) roomAnalyticsService.finishToolCall(toolCallId, { status: 'failed', errorCode: roomAnalyticsService.errorCode(err, 500), errorMessage: roomAnalyticsService.errorMessage(err) })
    throw err
  }
}
