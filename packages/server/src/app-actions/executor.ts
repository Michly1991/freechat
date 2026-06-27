import db from '../storage/db.js'
import { billingQueryRepository } from '../domains/billing/billing-query.repository.js'
import { microToCredit } from '../domains/billing/money.js'
import { creditWalletService } from '../services/credit-wallet.service.js'
import { agentService } from '../services/agent.service.js'
import { agentCapabilityService } from '../services/agent-capability.service.js'
import { agentKnowledgeService } from '../services/agent-knowledge.service.js'
import { agentModelConfigService } from '../services/agent-model-config.service.js'
import { modelProfileService } from '../services/model-profile.service.js'
import { assertActorCanUseAgentInRoom } from '../routes/agent-tools.helpers.js'
import { getAppAction, listAppActions } from './registry.js'

export interface AppActionContext {
  roomId: string
  agentId: string
  actorUserId: string
  actorRole?: string
}

function toInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

function billingRole(value: any): 'payer' | 'agent_provider' | 'model_provider' | 'scene_provider' {
  return ['agent_provider', 'model_provider', 'scene_provider'].includes(value) ? value : 'payer'
}

function rangeFromArgs(args: any) {
  const now = Date.now()
  if (args?.range === 'today') {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    return { from: d.getTime(), to: now }
  }
  if (args?.range === 'this_month') {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0)
    return { from: d.getTime(), to: now }
  }
  return { from: args?.from ? Number(args.from) : undefined, to: args?.to ? Number(args.to) : undefined }
}

function publicAccount(account: { balance: number; incomeBalance: number }) {
  return { balance: microToCredit(account.balance), incomeBalance: microToCredit(account.incomeBalance) }
}

async function resolveAgentForActor(ctx: AppActionContext, raw?: any) {
  const text = String(raw || '').trim()
  if (!text) return agentService.getAgent(ctx.agentId)
  const roomAgents = await agentService.getRoomAgents(ctx.roomId)
  const roomMatch = roomAgents.find((a: any) => a.id === text || a.name === text || a.name.includes(text) || text.includes(a.name))
  if (roomMatch) return roomMatch
  const visible = await agentService.getUserAgents(ctx.actorUserId)
  const matched = visible.find((a: any) => a.id === text || a.name === text || a.name.includes(text) || text.includes(a.name))
  if (matched) return matched
  await assertActorCanUseAgentInRoom(ctx.roomId, text, ctx.actorUserId)
  return agentService.getAgent(text)
}

function sanitizeAgent(agent: any) {
  return {
    id: agent.id,
    ownerId: agent.ownerId,
    ownerName: agent.ownerName,
    name: agent.name,
    roleType: agent.roleType,
    deployment: agent.deployment,
    description: agent.description,
    specialties: agent.specialties || [],
    status: agent.status,
    onlineStatus: agent.onlineStatus,
    roomRole: agent.roomRole,
    autoEnabled: agent.autoEnabled,
    roomPriority: agent.roomPriority,
    isTemplate: agent.isTemplate,
    sourceTemplateId: agent.sourceTemplateId,
    marketListed: agent.marketListed,
    canDelete: agent.canDelete,
    builtInKey: agent.builtInKey,
    isBuiltIn: agent.isBuiltIn,
    defaultModelConfig: agent.defaultModelConfig,
    roomModelConfig: agent.roomModelConfig,
  }
}

export async function executeAppAction(ctx: AppActionContext, action: string, args: any = {}): Promise<{ handled: boolean; response?: any }> {
  switch (action) {
    case 'tool.help':
    case 'tool.schema': {
      const name = String(args.name || args.tool || args.action || '').trim()
      const meta = getAppAction(name)
      return { handled: true, response: { success: true, data: meta ? { tool: meta } : { name, input: 'JSON object args', transport: { action: name, args: {} } } } }
    }
    case 'app.call':
    case 'tool.call': {
      const target = String(args.action || args.tool || args.name || '').trim()
      if (!target) throw { code: 'VALIDATION_ERROR', message: 'action is required' }
      if (target === 'app.call' || target === 'tool.call') throw { code: 'VALIDATION_ERROR', message: 'nested app.call is not allowed' }
      return executeAppAction(ctx, target, args.args || args.params || {})
    }
    case 'agent.detail': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      await assertActorCanUseAgentInRoom(ctx.roomId, target.id, ctx.actorUserId)
      const agent = await agentService.getAgent(target.id)
      return { handled: true, response: { success: true, data: { agent: sanitizeAgent(agent), skills: agentCapabilityService.listSkills(agent.id), scripts: agentCapabilityService.listScripts(agent.id) } } }
    }
    case 'agent.model.get': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      await assertActorCanUseAgentInRoom(ctx.roomId, target.id, ctx.actorUserId)
      const agent = await agentService.getAgent(target.id)
      return { handled: true, response: { success: true, data: { agent: sanitizeAgent(agent), effective: agentModelConfigService.getEffectiveConfig(ctx.roomId, agent.id), roomOverride: agent.roomModelConfig, agentDefault: agent.defaultModelConfig } } }
    }
    case 'agent.model.update-default': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      await agentService.assertAgentOwner(target.id, ctx.actorUserId, ctx.actorRole)
      const agent = await agentService.updateAgentDefaultModelConfig(target.id, args.config || args, ctx.actorUserId)
      return { handled: true, response: { success: true, data: { agent: sanitizeAgent(agent) } } }
    }
    case 'agent.room-model.update': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      const member = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(ctx.roomId, ctx.actorUserId) as any
      if (!member || !['owner', 'editor'].includes(member.role)) throw { code: 'FORBIDDEN', message: 'Only project owner/editor can update room Agent model config' }
      const agent = await agentService.updateRoomAgentModelConfig(ctx.roomId, target.id, args.inherit === true ? null : (args.config || args), ctx.actorUserId)
      return { handled: true, response: { success: true, data: { agent: sanitizeAgent(agent) } } }
    }
    case 'agent.knowledge.list': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      await assertActorCanUseAgentInRoom(ctx.roomId, target.id, ctx.actorUserId)
      return { handled: true, response: { success: true, data: agentKnowledgeService.list(target.id, false) } }
    }
    case 'agent.knowledge.search': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      await assertActorCanUseAgentInRoom(ctx.roomId, target.id, ctx.actorUserId)
      return { handled: true, response: { success: true, data: agentKnowledgeService.search(target.id, String(args.query || args.q || ''), { limit: Number(args.limit || 8), includePublic: args.includePublic !== false }) } }
    }
    case 'agent.knowledge.read': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      await assertActorCanUseAgentInRoom(ctx.roomId, target.id, ctx.actorUserId)
      return { handled: true, response: { success: true, data: agentKnowledgeService.read(target.id, String(args.ref || args.fileId || args.path || '')) } }
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
    case 'billing.account':
      return { handled: true, response: { success: true, data: { account: publicAccount(creditWalletService.getAccount(ctx.actorUserId)) } } }
    case 'billing.ledger': {
      const role = billingRole(args.role)
      const limit = Math.min(100, Math.max(1, toInt(args.limit || 50)))
      return { handled: true, response: { success: true, data: { role, items: billingQueryRepository.listLedger(ctx.actorUserId, role, rangeFromArgs(args), limit) } } }
    }
    case 'billing.summary': {
      const role = billingRole(args.role), range = rangeFromArgs(args)
      return { handled: true, response: { success: true, data: { role, account: publicAccount(creditWalletService.getAccount(ctx.actorUserId)), summary: billingQueryRepository.summary(ctx.actorUserId, role, range), byProject: billingQueryRepository.groupedByProject(ctx.actorUserId, role, range), byAgent: billingQueryRepository.groupedByAgent(ctx.actorUserId, role, range), byModel: billingQueryRepository.groupedByModel(ctx.actorUserId, role, range), byScenePurchase: billingQueryRepository.groupedByScenePurchase(ctx.actorUserId, role, range), daily: billingQueryRepository.daily(ctx.actorUserId, role), unbilledUsage: role === 'payer' ? billingQueryRepository.unbilledUsage(ctx.actorUserId, range) : null } } }
    }
    case 'model.profile.list':
      return { handled: true, response: { success: true, data: { profiles: modelProfileService.listVisible(ctx.actorUserId, ctx.actorRole) } } }
    default:
      return { handled: false }
  }
}

export function appActionList(category?: string) {
  return listAppActions(category)
}
