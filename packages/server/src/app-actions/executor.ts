import { readFile } from 'fs/promises'
import { extname, join } from 'path'
import db from '../storage/db.js'
import { agentService } from '../services/agent.service.js'
import { agentCapabilityService } from '../services/agent-capability.service.js'
import { agentModelConfigService } from '../services/agent-model-config.service.js'
import { assertActorCanUseAgentInRoom } from '../routes/agent-tools.helpers.js'
import { getAppAction, listAppActions } from './registry.js'
import { roomFileService } from '../services/room-file.service.js'
import { config } from '../config.js'
import { assertRoomMember } from '../utils/room-authz.js'
import { officeDocumentService } from '../services/office-document.service.js'
import { mindmapArtifactService } from '../services/mindmap-artifact.service.js'
import { runRegisteredAppAction } from './registry.js'
import type { ToolExecutionContext } from './types.js'

export interface AppActionContext {
  roomId: string
  agentId: string
  actorUserId: string
  actorRole?: string
  scopeRoomId?: string
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
  const registered = await runRegisteredAppAction({ ...ctx, action, args, transport: 'server-internal' } as ToolExecutionContext, args)
  if (registered.handled) return registered

  switch (action) {
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
    case 'file.list': {
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId)
      assertRoomMember(scopeRoomId, ctx.actorUserId)
      return { handled: true, response: { success: true, data: roomFileService.list(scopeRoomId, { source: args.source, includeMessageAttachments: args.includeMessageAttachments !== false }) } }
    }
    case 'file.info': {
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId)
      assertRoomMember(scopeRoomId, ctx.actorUserId)
      const ref = String(args.ref || args.fileId || args.id || args.path || '')
      const row = roomFileService.resolveRef(scopeRoomId, ref)
      return { handled: true, response: { success: true, data: { file: roomFilePublic(row), hint: row.id ? `文本文件可用 file.read 读取；复杂文件请用 ./freechat file download file:${row.id} 下载处理。` : undefined } } }
    }
    case 'file.read': {
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId)
      assertRoomMember(scopeRoomId, ctx.actorUserId)
      const ref = String(args.ref || args.fileId || args.id || args.path || '')
      if (!ref) throw { code: 'VALIDATION_ERROR', message: 'file ref/path is required' }
      return { handled: true, response: { success: true, data: await readRoomTextFile(scopeRoomId, ref, args) } }
    }
    case 'pdf.read':
    case 'excel.read':
    case 'word.read':
    case 'ppt.read': {
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId)
      assertRoomMember(scopeRoomId, ctx.actorUserId)
      const ref = String(args.ref || args.fileId || args.id || args.path || '')
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
      const ref = String(args.ref || args.fileId || args.id || args.path || '')
      if (!ref) throw { code: 'VALIDATION_ERROR', message: 'file ref/path is required' }
      return { handled: true, response: { success: true, data: await officeDocumentService.readImage(scopeRoomId, ctx.agentId, ctx.actorUserId, ref, args) } }
    }
    case 'mindmap.create': {
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId)
      assertRoomMember(scopeRoomId, ctx.actorUserId)
      return { handled: true, response: { success: true, data: { preview: await mindmapArtifactService.createPreview(scopeRoomId, args) } } }
    }
    case 'mindmap.save': {
      const scopeRoomId = String(args.roomId || ctx.scopeRoomId || ctx.roomId)
      assertRoomMember(scopeRoomId, ctx.actorUserId)
      return { handled: true, response: { success: true, data: { saved: await mindmapArtifactService.save(scopeRoomId, ctx.actorUserId, args) } } }
    }
    default:
      return { handled: false }
  }
}

export function appActionList(category?: string) {
  return listAppActions(category)
}
