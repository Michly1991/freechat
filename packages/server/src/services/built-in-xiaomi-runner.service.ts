import { v4 as uuidv4 } from 'uuid'
import type { Agent } from '@freechat/shared'
import db from '../storage/db.js'
import { aiConfigService } from './ai-config.service.js'
import { messageService } from './message.service.js'
import { createAgentToolToken } from '../agent-tool-token.js'
import { config as appConfig } from '../config.js'
import { billingService } from './billing.service.js'

type RunOptions = { actorUserId?: string; timeoutMs?: number; onEvent?: (event: any) => void }

function trimPrompt(input: string) {
  return String(input || '').slice(-12000)
}

function toolHelp(roomId: string, agentId: string, actorUserId?: string) {
  const token = createAgentToolToken(roomId, agentId, actorUserId)
  return [
    '可用 FreeChat App Tools：如需执行应用操作，调用内部 HTTP API：',
    `POST http://127.0.0.1:${appConfig.port}/api/agent-tools/${roomId}`,
    `Authorization: Bearer ${token}`,
    'Body: {"action":"chat.send|task.list|file.read|tab.list|members.list|agent.list-available|agent.detail|interaction.confirm|...","args":{...}}',
    '危险操作必须先创建确认卡或获得明确确认；不要绕过当前用户权限。',
  ].join('\n')
}

function fallbackReply() {
  return [
    '我是小蜜。现在平台内置模型暂时不可用，但我可以先帮你梳理下一步：',
    '1. 想管理 Agent/Skill，可以告诉我要新建、修改还是排查哪个 Agent。',
    '2. 涉及删除、权限、API Key 或外部消息，我会先让你确认再执行。',
    '3. 如果要做项目协作，请把项目/房间和目标说清楚，我会按当前权限推进。',
  ].join('\n')
}

export class BuiltInXiaomiRunnerService {
  async run(roomId: string, agent: Agent, input: string, options: RunOptions = {}): Promise<{ response: string; silent: boolean }> {
    const startedAt = Date.now()
    const runId = `arun_${uuidv4()}`
    db.prepare(`
      INSERT INTO agent_runs (id, room_id, agent_id, status, input, actor_user_id, payer_user_id, run_source, runtime, started_at)
      VALUES (?, ?, ?, 'running', ?, ?, ?, 'built_in_xiaomi', 'freechat-built-in', ?)
    `).run(runId, roomId, agent.id, input, options.actorUserId || null, options.actorUserId || null, startedAt)

    try {
      options.onEvent?.({ type: 'activity', text: '正在调用平台内置小蜜模型' })
      const recent = await messageService.getMessages(roomId, 10).catch(() => [])
      const context = recent.map((m: any) => `${m.actorRole === 'ai' ? 'AI' : '用户'} ${m.actorName}: ${m.content}`).join('\n')
      const system = [agent.config?.systemPrompt || '', toolHelp(roomId, agent.id, options.actorUserId)].filter(Boolean).join('\n\n')
      const prompt = [context ? `最近对话：\n${context}` : '', `本次请求：\n${trimPrompt(input)}`].filter(Boolean).join('\n\n')
      let response = ''
      try {
        response = await aiConfigService.callAI(prompt, { system, maxTokens: agent.config?.model?.maxTokens || 1600, model: agent.config?.model?.model })
      } catch (err: any) {
        response = fallbackReply()
        options.onEvent?.({ type: 'activity', text: `模型调用失败，返回降级说明：${err?.message || err}` })
      }
      const now = Date.now()
      db.prepare("UPDATE agent_runs SET status = 'succeeded', output = ?, runtime = 'freechat-built-in', model = ?, duration_ms = ?, finished_at = ? WHERE id = ?")
        .run(response, agent.config?.model?.model || null, now - startedAt, now, runId)
      billingService.billRun(runId)
      db.prepare("UPDATE agents SET status = 'active', updated_at = ? WHERE id = ?").run(now, agent.id)
      return { response, silent: !response }
    } catch (err: any) {
      const now = Date.now()
      db.prepare("UPDATE agent_runs SET status = 'failed', error = ?, runtime = 'freechat-built-in', duration_ms = ?, finished_at = ? WHERE id = ?")
        .run(err?.message || String(err), now - startedAt, now, runId)
      db.prepare("UPDATE agents SET status = 'error', updated_at = ? WHERE id = ?").run(now, agent.id)
      throw err
    }
  }
}

export function createBuiltInXiaomiRunner() {
  return new BuiltInXiaomiRunnerService()
}
