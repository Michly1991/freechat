import { readFile } from 'fs/promises'
import { extname, join } from 'path'
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
import { roomFileService } from '../services/room-file.service.js'
import { config } from '../config.js'
import { assertRoomMember } from '../utils/room-authz.js'
import { officeDocumentService } from '../services/office-document.service.js'

export interface AppActionContext {
  roomId: string
  agentId: string
  actorUserId: string
  actorRole?: string
  scopeRoomId?: string
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

const TEXT_FILE_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.log', '.yaml', '.yml', '.xml', '.html', '.htm', '.css', '.js', '.ts', '.tsx', '.jsx'])

function isTextRoomFile(path: string, mimeType?: string | null) {
  const mime = String(mimeType || '').toLowerCase()
  if (mime.startsWith('text/')) return true
  if (/json|xml|yaml|csv|javascript|typescript/.test(mime)) return true
  return TEXT_FILE_EXTENSIONS.has(extname(path).toLowerCase())
}

function roomFilePublic(row: any) {
  return {
    id: row.id,
    ref: row.id ? `file:${row.id}` : undefined,
    name: row.name,
    path: row.relative_path,
    mimeType: row.mime_type || undefined,
    size: row.size || 0,
    source: row.source,
    messageId: row.message_id || undefined,
    createdAt: row.created_at,
  }
}

async function readRoomTextFile(roomId: string, refOrPath: string, args: any = {}) {
  const row = roomFileService.resolveRef(roomId, refOrPath)
  const rel = row.storage_path || row.relative_path
  if (!isTextRoomFile(row.relative_path || rel, row.mime_type) && args.force !== true) {
    throw { code: 'BINARY_FILE_REQUIRES_DOWNLOAD', message: '该文件不是可直接内联读取的文本文件，请使用 ./freechat file download file:<fileId> 下载到本地处理。' }
  }
  const offset = Math.max(0, Number(args.offset || 0) || 0)
  const limit = Math.min(Math.max(1, Number(args.limit || args.maxBytes || 120_000) || 120_000), 500_000)
  const fullPath = join(config.workspace.root, roomId, 'files', rel)
  const content = await readFile(fullPath, 'utf8')
  return { file: roomFilePublic(row), content: content.slice(offset, offset + limit), offset, limit, truncated: offset + limit < content.length, totalChars: content.length }
}

async function resolveAgentForActor(ctx: AppActionContext, raw?: any) {
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
      const nextArgs = args.args || args.params || {}
      const scopeRoomId = args.roomId || args.scopeRoomId || nextArgs.roomId || nextArgs.scopeRoomId || ctx.scopeRoomId
      return executeAppAction({ ...ctx, scopeRoomId }, target, nextArgs)
    }
    case 'agent.detail': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      if (ctx.scopeRoomId) await assertActorCanUseAgentInRoom(ctx.scopeRoomId, target.id, ctx.actorUserId)
      const agent = await agentService.getAgent(target.id)
      return { handled: true, response: { success: true, data: { agent: sanitizeAgent(agent), skills: agentCapabilityService.listSkills(agent.id), scripts: agentCapabilityService.listScripts(agent.id) } } }
    }
    case 'agent.model.get': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      if (ctx.scopeRoomId) await assertActorCanUseAgentInRoom(ctx.scopeRoomId, target.id, ctx.actorUserId)
      const agent = await agentService.getAgent(target.id)
      return { handled: true, response: { success: true, data: { agent: sanitizeAgent(agent), effective: agentModelConfigService.getEffectiveConfig(ctx.scopeRoomId || ctx.roomId, agent.id), roomOverride: agent.roomModelConfig, agentDefault: agent.defaultModelConfig } } }
    }
    case 'agent.model.update-default': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      await agentService.assertAgentOwner(target.id, ctx.actorUserId, ctx.actorRole)
      const agent = await agentService.updateAgentDefaultModelConfig(target.id, args.config || args, ctx.actorUserId)
      return { handled: true, response: { success: true, data: { agent: sanitizeAgent(agent) } } }
    }
    case 'agent.room-model.update': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId)
      const member = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(scopeRoomId, ctx.actorUserId) as any
      if (!member || !['owner', 'editor'].includes(member.role)) throw { code: 'FORBIDDEN', message: 'Only project owner/editor can update room Agent model config' }
      const agent = await agentService.updateRoomAgentModelConfig(scopeRoomId, target.id, args.inherit === true ? null : (args.config || args), ctx.actorUserId)
      return { handled: true, response: { success: true, data: { agent: sanitizeAgent(agent) } } }
    }
    case 'agent.knowledge.list': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      if (ctx.scopeRoomId) await assertActorCanUseAgentInRoom(ctx.scopeRoomId, target.id, ctx.actorUserId)
      return { handled: true, response: { success: true, data: agentKnowledgeService.list(target.id, false) } }
    }
    case 'agent.knowledge.search': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      if (ctx.scopeRoomId) await assertActorCanUseAgentInRoom(ctx.scopeRoomId, target.id, ctx.actorUserId)
      return { handled: true, response: { success: true, data: agentKnowledgeService.search(target.id, String(args.query || args.q || ''), { limit: Number(args.limit || 8), includePublic: args.includePublic !== false }) } }
    }
    case 'agent.knowledge.read': {
      const target = await resolveAgentForActor(ctx, args.agent || args.agentId || args.id)
      if (ctx.scopeRoomId) await assertActorCanUseAgentInRoom(ctx.scopeRoomId, target.id, ctx.actorUserId)
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
    case 'file.list': {
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId)
      assertRoomMember(scopeRoomId, ctx.actorUserId)
      return { handled: true, response: { success: true, data: roomFileService.list(scopeRoomId) } }
    }
    case 'file.info': {
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId)
      assertRoomMember(scopeRoomId, ctx.actorUserId)
      const ref = String(args.ref || args.fileId || args.path || '')
      const row = roomFileService.resolveRef(scopeRoomId, ref)
      return { handled: true, response: { success: true, data: { file: roomFilePublic(row), hint: row.id ? `文本文件可用 file.read 读取；复杂文件请用 ./freechat file download file:${row.id} 下载处理。` : undefined } } }
    }
    case 'file.read': {
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId)
      assertRoomMember(scopeRoomId, ctx.actorUserId)
      const ref = String(args.ref || args.fileId || args.path || '')
      if (!ref) throw { code: 'VALIDATION_ERROR', message: 'file ref/path is required' }
      return { handled: true, response: { success: true, data: await readRoomTextFile(scopeRoomId, ref, args) } }
    }
    case 'pdf.read':
    case 'excel.read':
    case 'word.read':
    case 'ppt.read': {
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId)
      assertRoomMember(scopeRoomId, ctx.actorUserId)
      const ref = String(args.ref || args.fileId || args.path || '')
      if (!ref) throw { code: 'VALIDATION_ERROR', message: 'file ref/path is required' }
      const kind = action.split('.')[0] as any
      return { handled: true, response: { success: true, data: await officeDocumentService.read(kind, scopeRoomId, ref, args) } }
    }
    case 'excel.write':
    case 'word.write':
    case 'ppt.write': {
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId)
      assertRoomMember(scopeRoomId, ctx.actorUserId)
      const kind = action.split('.')[0] as any
      return { handled: true, response: { success: true, data: await officeDocumentService.write(kind, scopeRoomId, ctx.actorUserId, args) } }
    }
    case 'image.read': {
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId)
      assertRoomMember(scopeRoomId, ctx.actorUserId)
      const ref = String(args.ref || args.fileId || args.path || '')
      if (!ref) throw { code: 'VALIDATION_ERROR', message: 'file ref/path is required' }
      return { handled: true, response: { success: true, data: await officeDocumentService.readImage(scopeRoomId, ctx.agentId, ctx.actorUserId, ref, args) } }
    }
    default:
      return { handled: false }
  }
}

export function appActionList(category?: string) {
  return listAppActions(category)
}
