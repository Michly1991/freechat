import db from '../storage/db.js'
import { messageService } from './message.service.js'
import { createAgentToolToken } from '../agent-tool-token.js'
import { config as appConfig } from '../config.js'
import type { ConnectorAuth } from './remote-agent-connector.service.js'
import { executeInlineToolCalls } from './inline-agent-tool.service.js'
import { modelRuntimeService } from './model-runtime.service.js'
import { conversationMemoryService } from './conversation-memory.service.js'
import { knowledgeRuntimeService } from './knowledge-runtime.service.js'
import { containsInlineToolMarkup, extractInlineToolCalls, stripInlineToolMarkup } from './inline-tool-markup.js'
import { executeTool } from '../app-actions/router.js'

function trimPrompt(input: string) {
  return String(input || '').slice(-12000)
}

function toolHelp(roomId: string, agentId: string, actorUserId?: string) {
  const token = createAgentToolToken(roomId, agentId, actorUserId)
  return [
    '可用 FreeChat App Tools：如需执行应用操作，调用内部 HTTP API：',
    `POST http://127.0.0.1:${appConfig.port}/api/agent-tools/${roomId}`,
    `Authorization: Bearer ${token}`,
        'Body: {"action":"app.call|chat.send|task.list|file.read|file.info|tab.list|members.list|agent.my-list|agent.detail|agent.knowledge.search|billing.summary|...","args":{...}}',
    '界面功能代操作优先用 app.call：{"action":"app.call","args":{"action":"agent.detail","args":{"agent":"张小猫"}}}。可先用 tool.list/tool.schema 查看能力。',
    '用户问“我有哪些 Agent/我的 Agent/通讯录 Agent”时用 agent.my-list；问“当前房间还能添加哪些 Agent”时用 agent.list-available。',
    '用户消息里出现 file:<fileId> 或附件提示时，必须先按文件类型调用对应能力：PDF 用 pdf.read；Excel 用 excel.read/excel.write；Word 用 word.read/word.write；PPT 用 ppt.read/ppt.write；图片用 image.read；普通文本用 file.read。不要在未读文件前说看不到附件。',
    '危险操作必须先创建确认卡或获得明确确认；不要绕过当前用户权限。',
  ].join('\n')
}

function fallbackReply() {
  return [
    '我是小蜜。现在平台托管模型暂时不可用，但我可以先帮你梳理下一步：',
    '1. 想管理 Agent/Skill，可以告诉我要新建、修改还是排查哪个 Agent。',
    '2. 涉及删除、权限、API Key 或外部消息，我会先让你确认再执行。',
    '3. 如果要做项目协作，请把项目/房间和目标说清楚，我会按当前权限推进。',
  ].join('\n')
}

function actionForAttachment(input: string) {
  const type = String(input || '').toLowerCase()
  if (/spreadsheet|excel|xlsx|xlsm|\.xlsx|\.xlsm/.test(type)) return 'excel.read'
  if (/pdf|\.pdf/.test(type)) return 'pdf.read'
  if (/word|document|docx|\.docx/.test(type)) return 'word.read'
  if (/presentation|powerpoint|pptx|\.pptx/.test(type)) return 'ppt.read'
  if (/image\/|\.png|\.jpe?g|\.webp|\.gif/.test(type)) return 'image.read'
  if (/text\/|\.txt|\.md|\.csv|\.json|\.log|\.ya?ml/.test(type)) return 'file.read'
  return ''
}

function extractAttachmentReads(text: string) {
  const seen = new Set<string>()
  const reads: Array<{ action: string; ref: string }> = []
  const source = String(text || '')
  const lineRe = /^-\s+ref:\s*(file:[^;\s]+);[\s\S]*?(?:name:\s*([^;\n]+);)?[\s\S]*?(?:type:\s*([^;\n]+);)?/gm
  for (const match of source.matchAll(lineRe)) {
    const ref = String(match[1] || '').trim()
    const action = actionForAttachment(`${match[2] || ''} ${match[3] || ''}`)
    const key = `${action}:${ref}`
    if (ref && action && !seen.has(key)) { seen.add(key); reads.push({ action, ref }) }
  }
  const fileIdRe = /fileId:\s*(file_[0-9a-f-]+)/gi
  for (const match of source.matchAll(fileIdRe)) {
    const ref = `file:${match[1]}`
    const around = source.slice(Math.max(0, match.index! - 300), Math.min(source.length, match.index! + 500))
    const action = actionForAttachment(around)
    const key = `${action}:${ref}`
    if (ref && action && !seen.has(key)) { seen.add(key); reads.push({ action, ref }) }
  }
  return reads.slice(0, 3)
}

function toolActions(calls: Array<{ name: string }>) {
  return new Set(calls.map((call) => String(call.name || '')))
}

function formatAutoToolResult(action: string, response: any) {
  if (!response?.success) {
    const err = response?.error
    const message = typeof err === 'string' ? err : err?.message || JSON.stringify(err || {})
    return `工具 ${action} 执行失败：${message}`
  }
  const data = response?.data || response
  if (['pdf.read', 'excel.read', 'word.read', 'ppt.read'].includes(action)) {
    const file = data?.file
    const body = data?.csv || data?.text || JSON.stringify(data?.rows || data?.slides || data, null, 2)
    const header = file ? `文件：${file.name || file.path}（${file.ref || file.path}）` : `工具结果：${action}`
    const tail = data?.truncated ? `\n\n[内容已截断，totalChars=${data.totalChars}]` : ''
    return `${header}\n${String(body || '')}${tail}`.slice(0, 12000)
  }
  if (action === 'file.read') {
    const file = data?.file
    const header = file ? `文件：${file.name || file.path}（${file.ref || file.path}）` : '文件内容：'
    const tail = data?.truncated ? `\n\n[内容已截断，totalChars=${data.totalChars}]` : ''
    return `${header}\n${String(data?.content || '')}${tail}`.slice(0, 12000)
  }
  if (action === 'image.read') {
    const file = data?.file
    return [`图片：${file?.name || file?.path || ''}`, data?.text || ''].filter(Boolean).join('\n').slice(0, 12000)
  }
  return JSON.stringify(data, null, 2).slice(0, 12000)
}

export class PlatformHostedAgentRuntimeService {
  canHandle(agentId: string) {
    const row = db.prepare("SELECT config FROM agents WHERE id = ? AND config LIKE '%\"builtInKey\":\"xiaomi_assistant\"%'").get(agentId) as any
    return !!row
  }

  async processPending(auth: ConnectorAuth, complete: (auth: ConnectorAuth, runId: string, payload: any) => any, fail: (auth: ConnectorAuth, runId: string, error: string) => any) {
    const events = await import('./remote-agent-connector.service.js').then((m) => m.remoteAgentConnectorService.pollEvents(auth, 5))
    for (const event of events) await this.handleEvent(auth, event, complete, fail)
    return { processed: events.length }
  }

  private async handleEvent(auth: ConnectorAuth, event: any, complete: (auth: ConnectorAuth, runId: string, payload: any) => any, fail: (auth: ConnectorAuth, runId: string, error: string) => any) {
    try {
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(auth.agentId) as any
      const cfg = agent?.config ? JSON.parse(agent.config) : {}
      const eventContext = event.payload?.context || null
      const context = String(eventContext?.promptText || '')
      const [roomMemory, agentMemory] = await Promise.all([
        conversationMemoryService.readRoomMemory(event.roomId),
        conversationMemoryService.readAgentMemory(event.roomId, auth.agentId),
      ])
      const memoryContext = [roomMemory ? `房间长期记忆：\n${roomMemory}` : '', agentMemory ? `当前 Agent 长期记忆：\n${agentMemory}` : ''].filter(Boolean).join('\n\n')
      const knowledgeContext = (() => {
        try { return knowledgeRuntimeService.getRuntimeContext(event.roomId, auth.agentId, event.payload?.input || '', 8) }
        catch { return '' }
      })()
      const system = [
        cfg.systemPrompt || '',
        toolHelp(event.roomId, auth.agentId, event.payload?.actorUserId || event.payload?.metadata?.actorUserId),
        '如果需要调用 App Tool，请只输出 <toolcall>{"name":"工具名","args":{...}}</toolcall>，不要在同一条回复里夹带给用户看的说明文字；系统执行工具后会把工具结果再交给你组织最终回复。创建 Agent 必须使用 agent.create 或 agent.create_request，系统会生成确认卡；查询 Agent 详情可用 agent.detail；读取附件/房间文件请按类型使用工具：文本 file.read、PDF pdf.read、Excel excel.read/excel.write、Word word.read/word.write、PPT ppt.read/ppt.write、图片 image.read；用户要求脑图/思维导图/XMind 风格结构图时使用 mindmap.create 先生成聊天内嵌预览，用户确认保存后再 mindmap.save，例如 {"name":"mindmap.create","args":{"title":"主题","outline":"# 主题\n- 分支"}}；代替界面操作优先用 app.call，例如 {"name":"app.call","args":{"action":"billing.summary","args":{"range":"this_month"}}}；不要只用 JSON 说明接口失败。',
      ].filter(Boolean).join('\n\n')
      const prompt = [memoryContext, knowledgeContext, context ? `最近对话：\n${context}` : '', `本次请求：\n${trimPrompt(event.payload?.input || '')}`].filter(Boolean).join('\n\n')
      let output = ''
      let aiUsage: any = null
      try {
        const actorUserId = event.payload?.actorUserId || event.payload?.metadata?.actorUserId
        const aiResult = await modelRuntimeService.callRoomAgentModel(event.roomId, auth.agentId, actorUserId, prompt, { system, maxTokens: cfg.model?.maxTokens || 1600, model: cfg.model?.model })
        output = aiResult.text
        aiUsage = {
          model: aiResult.model,
          ...aiResult.usage,
          modelProfileId: aiResult.modelProfileId,
          modelSource: aiResult.modelSource,
          modelProviderUserId: aiResult.modelProviderUserId,
          baseUrlHost: aiResult.baseUrlHost,
          isSelfProvidedModel: aiResult.isSelfProvidedModel,
        }
        const inlineCalls = extractInlineToolCalls(output)
        const inlineActions = toolActions(inlineCalls)
        const autoReads = extractAttachmentReads(event.payload?.input || '').filter((read) => !inlineActions.has(read.action))
        const autoReadSummaries: string[] = []
        for (const read of autoReads) {
          try {
            const result = await executeTool({ roomId: event.roomId, action: read.action, args: { ref: read.ref }, agentId: auth.agentId, actorUserId, actorRole: (db.prepare('SELECT role FROM users WHERE id = ?').get(actorUserId) as any)?.role, transport: 'platform-auto-read' }, { audit: true })
            autoReadSummaries.push(formatAutoToolResult(read.action, result))
          } catch (err: any) {
            autoReadSummaries.push(`工具 ${read.action} 执行失败：${err?.message || String(err)}`)
          }
        }
        const toolSummary = await executeInlineToolCalls(event.roomId, auth.agentId, actorUserId, output)
        const combinedToolSummary = [...autoReadSummaries, toolSummary].filter(Boolean).join('\n\n')
        if (combinedToolSummary) {
          const visibleLead = stripInlineToolMarkup(output)
          const followUpPrompt = [
            prompt,
            visibleLead ? `模型原始回复中的用户可见部分（不要复述工具标记）：\n${visibleLead}` : '',
            `刚刚执行的工具结果（仅供你分析，禁止原样转储接口 JSON；请基于结果直接回答用户）：\n${combinedToolSummary}`,
            '请现在给用户一条自然语言最终回复。不要包含 <toolcall>、JSON 接口载荷或“工具结果”原文；如果是表格/名单，请提炼关键结论，必要时用 Markdown 表格/要点。',
          ].filter(Boolean).join('\n\n')
          const finalResult = await modelRuntimeService.callRoomAgentModel(event.roomId, auth.agentId, actorUserId, followUpPrompt, { system, maxTokens: cfg.model?.maxTokens || 1600, model: cfg.model?.model })
          output = containsInlineToolMarkup(finalResult.text) ? stripInlineToolMarkup(finalResult.text) : finalResult.text
          aiUsage = {
            ...aiUsage,
            inputTokens: Number(aiUsage?.inputTokens || 0) + Number(finalResult.usage?.inputTokens || 0),
            outputTokens: Number(aiUsage?.outputTokens || 0) + Number(finalResult.usage?.outputTokens || 0),
            cacheCreationInputTokens: Number(aiUsage?.cacheCreationInputTokens || 0) + Number(finalResult.usage?.cacheCreationInputTokens || 0),
            cacheReadInputTokens: Number(aiUsage?.cacheReadInputTokens || 0) + Number(finalResult.usage?.cacheReadInputTokens || 0),
            totalTokens: Number(aiUsage?.totalTokens || 0) + Number(finalResult.usage?.totalTokens || 0),
            model: finalResult.model || aiUsage?.model,
          }
        }
      } catch (err: any) {
        output = fallbackReply()
      }
      complete(auth, event.runId, { output, responseMode: event.payload?.responseMode, usage: { model: aiUsage?.model || cfg.model?.model || undefined, ...aiUsage, usageSource: 'server_metered', trustLevel: aiUsage ? 'trusted' : 'fallback_no_model_usage' } })
    } catch (err: any) {
      fail(auth, event.runId, err?.message || String(err))
    }
  }
}

export const platformHostedAgentRuntimeService = new PlatformHostedAgentRuntimeService()
