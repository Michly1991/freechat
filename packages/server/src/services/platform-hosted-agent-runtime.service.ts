import db from '../storage/db.js'
import { aiConfigService } from './ai-config.service.js'
import { messageService } from './message.service.js'
import { createAgentToolToken } from '../agent-tool-token.js'
import { config as appConfig } from '../config.js'
import type { ConnectorAuth } from './remote-agent-connector.service.js'
import { executeInlineToolCalls } from './inline-agent-tool.service.js'

function trimPrompt(input: string) {
  return String(input || '').slice(-12000)
}

function toolHelp(roomId: string, agentId: string, actorUserId?: string) {
  const token = createAgentToolToken(roomId, agentId, actorUserId)
  return [
    '可用 FreeChat App Tools：如需执行应用操作，调用内部 HTTP API：',
    `POST http://127.0.0.1:${appConfig.port}/api/agent-tools/${roomId}`,
    `Authorization: Bearer ${token}`,
    'Body: {"action":"chat.send|task.list|file.read|tab.list|members.list|agent.my-list|agent.list-available|agent.detail|interaction.confirm|...","args":{...}}',
    '用户问“我有哪些 Agent/我的 Agent/通讯录 Agent”时用 agent.my-list；问“当前房间还能添加哪些 Agent”时用 agent.list-available。',
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
      const recent = await messageService.getMessages(event.roomId, 10).catch(() => [])
      const context = recent.map((m: any) => `${m.actorRole === 'ai' ? 'AI' : '用户'} ${m.actorName}: ${m.content}`).join('\n')
      const system = [cfg.systemPrompt || '', toolHelp(event.roomId, auth.agentId, event.payload?.actorUserId || event.payload?.metadata?.actorUserId)].filter(Boolean).join('\n\n')
      const prompt = [context ? `最近对话：\n${context}` : '', `本次请求：\n${trimPrompt(event.payload?.input || '')}`].filter(Boolean).join('\n\n')
      let output = ''
      try {
        output = await aiConfigService.callAI(prompt, { system, maxTokens: cfg.model?.maxTokens || 1600, model: cfg.model?.model })
        const toolSummary = await executeInlineToolCalls(event.roomId, auth.agentId, event.payload?.actorUserId || event.payload?.metadata?.actorUserId, output)
        if (toolSummary) output = toolSummary
      } catch (err: any) {
        output = fallbackReply()
      }
      complete(auth, event.runId, { output, responseMode: event.payload?.responseMode, usage: { model: cfg.model?.model || undefined, usageSource: 'server_metered', trustLevel: 'trusted' } })
    } catch (err: any) {
      fail(auth, event.runId, err?.message || String(err))
    }
  }
}

export const platformHostedAgentRuntimeService = new PlatformHostedAgentRuntimeService()
