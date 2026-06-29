import db from '../../storage/db.js'
import { agentService } from '../../services/agent.service.js'
import { agentKnowledgeService } from '../../services/agent-knowledge.service.js'
import { knowledgeRuntimeService } from '../../services/knowledge-runtime.service.js'
import { assertActorCanUseAgentInRoom } from '../../routes/agent-tools.helpers.js'
import type { ToolExecutionContext, ToolHandlerOutcome } from '../types.js'

async function resolveAgentForActor(ctx: ToolExecutionContext, raw?: any) {
  const text = String(raw || '').trim()
  if (!text) return agentService.getAgent(ctx.agentId)
  const visible = await agentService.getUserAgents(ctx.actorUserId)
  const matched = visible.find((a: any) => a.id === text || a.name === text || a.name.includes(text) || text.includes(a.name))
  if (matched) return matched
  if (ctx.scopeRoomId) {
    const roomAgents = await agentService.getRoomAgents(ctx.scopeRoomId)
    const roomMatch = roomAgents.find((a: any) => a.id === text || a.name === text || a.name.includes(text) || text.includes(a.name))
    if (roomMatch) return roomMatch
  }
  await assertActorCanUseAgentInRoom(ctx.scopeRoomId || ctx.roomId, text, ctx.actorUserId)
  return agentService.getAgent(text)
}

async function resolveReadableAgent(ctx: ToolExecutionContext, args: any) {
  const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
  if (ctx.scopeRoomId) await assertActorCanUseAgentInRoom(ctx.scopeRoomId, target.id, ctx.actorUserId)
  return target
}

export async function handleKnowledgeAction(ctx: ToolExecutionContext, args: any = {}): Promise<ToolHandlerOutcome> {
  switch (ctx.action) {
    case 'agent.knowledge.list': {
      const target = await resolveReadableAgent(ctx, args)
      return { handled: true, response: { success: true, data: agentKnowledgeService.list(target.id, false) } }
    }
    case 'agent.knowledge.search': {
      const target = await resolveReadableAgent(ctx, args)
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId || '')
      const targetInRoom = scopeRoomId ? !!db.prepare('SELECT 1 FROM room_agents WHERE room_id = ? AND agent_id = ?').get(scopeRoomId, target.id) : false
      if (scopeRoomId && targetInRoom) return { handled: true, response: { success: true, data: knowledgeRuntimeService.searchForAgent({ roomId: scopeRoomId, agentId: target.id, query: String(args.query || args.q || ''), limit: Number(args.limit || 8), includeRoom: args.includeRoom !== false, includeAgent: args.includeAgent !== false, includePublic: args.includePublic !== false }) } }
      return { handled: true, response: { success: true, data: agentKnowledgeService.search(target.id, String(args.query || args.q || ''), { limit: Number(args.limit || 8), includePublic: args.includePublic !== false }) } }
    }
    case 'agent.knowledge.read': {
      const target = await resolveReadableAgent(ctx, args)
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId || '')
      const ref = String(args.ref || args.fileId || args.path || '')
      const targetInRoom = scopeRoomId ? !!db.prepare('SELECT 1 FROM room_agents WHERE room_id = ? AND agent_id = ?').get(scopeRoomId, target.id) : false
      if (scopeRoomId && targetInRoom && /^(room|agent|agent-entry|public):/.test(ref)) return { handled: true, response: { success: true, data: knowledgeRuntimeService.readForAgent({ roomId: scopeRoomId, agentId: target.id, ref }) } }
      return { handled: true, response: { success: true, data: agentKnowledgeService.read(target.id, ref) } }
    }
    case 'agent.knowledge.upsert': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      const agent = await agentService.getAgent(target.id)
      await agentService.assertAgentOwner(target.id, ctx.actorUserId, ctx.actorRole)
      const file = agentKnowledgeService.upsert(target.id, agent.ownerId || ctx.actorUserId, { name: args.name, path: args.path || args.name, content: args.content, mimeType: args.mimeType }, ctx.actorUserId)
      return { handled: true, response: { success: true, data: { file, knowledge: agentKnowledgeService.list(target.id, false) } } }
    }
    case 'agent.knowledge.delete': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      await agentService.assertAgentOwner(target.id, ctx.actorUserId, ctx.actorRole)
      const fileId = args.fileId || args.id || args.ref
      if (!fileId) throw { code: 'VALIDATION_ERROR', message: 'fileId is required' }
      agentKnowledgeService.delete(target.id, String(fileId), ctx.actorUserId)
      return { handled: true, response: { success: true, data: { knowledge: agentKnowledgeService.list(target.id, false) } } }
    }
    case 'agent.knowledge.reindex': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      await agentService.assertAgentOwner(target.id, ctx.actorUserId, ctx.actorRole)
      return { handled: true, response: { success: true, data: agentKnowledgeService.reindex(target.id) } }
    }
    default:
      return { handled: false }
  }
}
