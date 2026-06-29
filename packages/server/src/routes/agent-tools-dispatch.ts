import { join } from 'path'
import { executeAppAction } from '../app-actions/executor.js'
import { handleAppUiTool } from './agent-tools.app-ui.js'
import { handleFileTool } from './agent-tools-file.js'
import { handleTabTool } from './agent-tools-tab.js'
import { handleAgentTaskTool } from './agent-tools-task.js'
import { handleAgentInteractionTabTool } from './agent-tools-interaction-tab.js'
import { handleAgentAdminTool } from './agent-tools-admin.js'
import { agentService } from '../services/agent.service.js'
import { config } from '../config.js'
import { broadcast as broadcastHelper } from './agent-tools.helpers.js'
import { roomFileService } from '../services/room-file.service.js'

export interface LocalAgentToolContext {
  roomId: string
  action: string
  args: any
  agentId: string
  actorUserId: string
  actorRole?: string
  emitActivity?: (tool: string) => void
  recordMindmapPreview?: boolean
}

function assertActorCanEditRoom(roomId: string, actorUserId: string, db: any) {
  const member = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, actorUserId) as any
  if (!member || !['owner', 'editor'].includes(member.role)) throw { code: 'FORBIDDEN', message: 'Only project owner/editor can perform this operation' }
}

async function maybeRecordMindmapPreview(ctx: LocalAgentToolContext, response: any, agent: any, db: any, messageService?: any) {
  if (!ctx.recordMindmapPreview || ctx.action !== 'mindmap.create' || response?.success === false || !response?.data?.preview || !messageService) return
  const preview = response.data.preview
  const sourceRefs = Array.isArray(ctx.args?.sourceRefs) && ctx.args.sourceRefs.length
    ? ctx.args.sourceRefs
    : recentFileRefs(ctx.roomId, 3)
  if (sourceRefs.length && !preview.sourceRefs?.length) preview.sourceRefs = sourceRefs
  const msg = await messageService.createMessage(ctx.roomId, agent.id, agent.name || (db.prepare('SELECT name FROM agents WHERE id = ?').get(agent.id) as any)?.name || 'Agent', 'ai', `脑图预览：${preview.title}`, undefined, undefined, 'artifact_preview', { artifactType: 'mindmap', preview })
  broadcastHelper(ctx.roomId, 'chat.message', msg)
}

function recentFileRefs(roomId: string, limit = 3) {
  return (roomFileService.list(roomId, { source: 'message_attachment' }).files || [])
    .slice(0, limit)
    .map((file: any) => file.ref || (file.id ? `file:${file.id}` : ''))
    .filter(Boolean)
}

export async function executeLocalAgentTool(ctx: LocalAgentToolContext, deps: { db: any; messageService?: any }): Promise<any> {
  const db = deps.db
  const agent = await agentService.getAgent(ctx.agentId)
  agentService.assertToolAllowed(agent, String(ctx.action || ''))
  ctx.emitActivity?.(String(ctx.action || ''))
  let response: any
  const filesDir = join(config.workspace.root, ctx.roomId, 'files')
  const broadcast = broadcastHelper

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
    const adminTool = await handleAgentAdminTool({ action: ctx.action, args: ctx.args || {}, roomId: ctx.roomId, actorUserId: ctx.actorUserId, agent, assertActorCanEditRoom: () => assertActorCanEditRoom(ctx.roomId, ctx.actorUserId, db), broadcast })
    if (adminTool.handled) response = adminTool.response
  }
  if (!response) {
    const appAction = await executeAppAction({ roomId: ctx.roomId, agentId: agent.id, actorUserId: ctx.actorUserId, actorRole: ctx.actorRole }, ctx.action, ctx.args || {})
    if (appAction.handled) response = appAction.response
  }
  if (!response) throw { code: 'UNKNOWN_ACTION', message: `Unknown action: ${ctx.action}` }
  await maybeRecordMindmapPreview(ctx, response, agent, db, deps.messageService)
  return response
}
