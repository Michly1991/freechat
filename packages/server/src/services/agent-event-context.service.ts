import type { Message, MessageAttachment } from '@freechat/shared'
import { messageService, renderMessageForAgentContext } from './message.service.js'
import { roomFileService } from './room-file.service.js'

export type AgentEventContext = {
  version: 1
  roomId: string
  agentId: string
  actorUserId?: string
  input: string
  recentMessages: Array<{
    id: string
    actorName: string
    actorRole: string
    kind: string
    content: string
    attachments?: MessageAttachment[]
    createdAt: number
  }>
  recentFileRefs: Array<{
    id: string
    ref: string
    name: string
    relativePath: string
    mimeType?: string
    size: number
    source: string
    messageId?: string
    createdAt: number
  }>
  promptText: string
}

function compactMessage(message: Message): AgentEventContext['recentMessages'][number] {
  return {
    id: message.id,
    actorName: message.actorName,
    actorRole: message.actorRole,
    kind: String(message.kind || 'text'),
    content: message.content,
    attachments: message.attachments,
    createdAt: message.createdAt,
  }
}

function fileRefToPromptLine(file: AgentEventContext['recentFileRefs'][number]) {
  return `- ${file.name} (${file.ref}); type=${file.mimeType || 'unknown'}; source=${file.source}; path=${file.relativePath}`
}

export class AgentEventContextService {
  async build(input: { roomId: string; agentId: string; actorUserId?: string; input?: string; recentLimit?: number; fileLimit?: number }): Promise<AgentEventContext> {
    const recentLimit = Math.max(1, Math.min(50, Number(input.recentLimit || 20)))
    const fileLimit = Math.max(1, Math.min(20, Number(input.fileLimit || 8)))
    const recent = await messageService.getMessages(input.roomId, recentLimit).catch(() => [])
    const files = roomFileService.list(input.roomId, { includeMessageAttachments: true }).files.slice(0, fileLimit).map((file) => ({
      id: file.id,
      ref: file.ref,
      name: file.name,
      relativePath: file.relativePath,
      mimeType: file.mimeType,
      size: file.size,
      source: file.source,
      messageId: file.messageId,
      createdAt: file.createdAt,
    }))
    const messageText = recent.map((message) => renderMessageForAgentContext(message)).join('\n')
    const fileText = files.length
      ? `\n\n当前房间最近文件/聊天附件（用户说“刚才的文件/上面的附件/那个表格”时优先使用这些 ref）：\n${files.map(fileRefToPromptLine).join('\n')}`
      : ''
    return {
      version: 1,
      roomId: input.roomId,
      agentId: input.agentId,
      actorUserId: input.actorUserId,
      input: String(input.input || ''),
      recentMessages: recent.map(compactMessage),
      recentFileRefs: files,
      promptText: [messageText ? `最近对话：\n${messageText}` : '', fileText].filter(Boolean).join('\n'),
    }
  }
}

export const agentEventContextService = new AgentEventContextService()
