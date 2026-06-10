import { v4 as uuidv4 } from 'uuid'
import { agentService } from '../services/agent.service.js'
import { interactionService } from '../services/interaction.service.js'
import { messageService } from '../services/message.service.js'
import { agentTaskCompletionService } from '../services/agent-task-completion.service.js'
import { fileMentionContextService } from '../services/file-mention-context.service.js'
import { config } from '../config.js'
import { buildAssistantAutoPrompt, shouldConsiderAssistantAutoReply } from './assistant-auto-prompt.js'
import type { BroadcastToRoom, InvokeReason } from './gateway-types.js'

export class AgentInvocationHandler {
  private assistantAutoReplyCooldowns: Map<string, number> = new Map()

  constructor(private broadcastToRoom: BroadcastToRoom) {}

  async maybeCreateObviousExpertTaskPlan(roomId: string, assistant: any, content: string): Promise<boolean> {
    const text = String(content || '')
    const wantsScript = /剧本|编剧|脚本|文字/.test(text)
    const wantsStoryboard = /分镜|镜头|画面|运镜/.test(text)
    if (!wantsScript || !wantsStoryboard) return false

    const agents = await agentService.getRoomAgents(roomId)
    const scriptAgent = agents.find((a) => a.id !== assistant.id && (/剧本|编剧/.test(a.name) || a.specialties?.some((s) => /剧本|编剧|脚本|文字/.test(s))))
    const storyboardAgent = agents.find((a) => a.id !== assistant.id && (/分镜|镜头/.test(a.name) || a.specialties?.some((s) => /分镜|镜头|画面/.test(s))))
    if (!scriptAgent || !storyboardAgent) return false

    await agentService.updateAgent(assistant.id, { status: 'working' } as any).catch(() => {})
    this.broadcastToRoom(roomId, {
      msgId: uuidv4(),
      roomId,
      type: 'broadcast',
      action: 'agent.status_update',
      payload: { agentId: assistant.id, status: 'working', onlineStatus: 'working', lastActiveAt: Date.now() },
      timestamp: Date.now()
    })

    const result = await interactionService.create(roomId, { id: assistant.id, name: assistant.name, role: 'ai' }, {
      type: 'task_plan',
      title: '任务计划预览：剧本与分镜协作',
      description: '我会先让编剧专家完成文字剧本，再让分镜专家基于剧本输出分镜。未指定时长/受众时先按短视频默认方案处理，后续可调整。',
      priority: 'important',
      payload: {
        taskPlan: {
          title: '创作热血题材剧本与分镜',
          description: `根据用户需求创建剧本与分镜：${text}`,
          priority: 'medium',
          items: [
            { title: '创作热血题材文字剧本', description: '完成人物、剧情结构、场景、对白和节奏设计。', assignee: scriptAgent.name },
            { title: '基于剧本生成分镜脚本', description: '根据剧本输出镜头、画面、运镜、台词/旁白和画面节奏。', assignee: storyboardAgent.name, dependsOn: 0 },
          ],
        },
      },
    })
    this.broadcastToRoom(roomId, { msgId: result.message.id, roomId, type: 'broadcast', action: 'chat.message', payload: result.message, timestamp: Date.now() })
    this.broadcastToRoom(roomId, { msgId: uuidv4(), roomId, type: 'broadcast', action: 'interaction.created', payload: { interaction: result.interaction }, timestamp: Date.now() })
    await agentService.updateAgent(assistant.id, { status: 'active' } as any).catch(() => {})
    this.broadcastToRoom(roomId, {
      msgId: uuidv4(),
      roomId,
      type: 'broadcast',
      action: 'agent.status_update',
      payload: { agentId: assistant.id, status: 'active', onlineStatus: 'online', lastActiveAt: Date.now() },
      timestamp: Date.now()
    })
    return true
  }

  async maybeAutoInvokeAssistant(roomId: string, actorName: string, content: string, mentions: any[] = []) {
    const pendingInteractions = interactionService.list(roomId, { status: 'pending' }).slice(0, 5)
    const pendingReplyText = pendingInteractions.length > 0 && /^(确认|可以|同意|开始|继续|取消|不要|不用|否|好|好的|ok|OK|yes|no)[。.!！?？]*$/.test(String(content || '').trim())
    if (!shouldConsiderAssistantAutoReply(content, { hasPendingInteraction: pendingInteractions.length > 0 })) return

    const now = Date.now()
    const last = this.assistantAutoReplyCooldowns.get(roomId) || 0
    const cooldownMs = 30_000
    if (!pendingReplyText && now - last < cooldownMs) return

    const assistant = await agentService.getAutoAgent(roomId)
    if (!assistant) return

    this.assistantAutoReplyCooldowns.set(roomId, now)

    if (await this.maybeCreateObviousExpertTaskPlan(roomId, assistant, content)) return

    const recentMessages = await messageService.getMessages(roomId, 12)
    const context = recentMessages
      .filter((m: any) => m.kind !== 'agent_receipt')
      .slice(-10)
      .map((m) => `${m.actorRole === 'ai' ? 'AI' : '用户'} ${m.actorName}: ${m.content}`)
      .join('\n')

    const prompt = buildAssistantAutoPrompt({
      context,
      actorName,
      content: `${content}${await fileMentionContextService.build(roomId, mentions)}`,
      pendingInteractions: pendingInteractions.map((item) => ({ id: item.id, type: item.type, title: item.title, description: item.description })),
    })

    await this.invokeMentionedAgents(roomId, prompt, [{ id: assistant.id, name: assistant.name, role: 'ai' }], 'auto')
  }

  async invokeMentionedAgents(roomId: string, content: string, mentions: any[], receiptReason: InvokeReason = 'mention') {
    const agentMentions = mentions.filter((m) => m?.role === 'ai' && m?.id)
    if (agentMentions.length === 0) return

    const uniqueAgentIds = Array.from(new Set(agentMentions.map((m) => m.id)))
    const roomAgents = await agentService.getRoomAgents(roomId)
    const roomAgentIds = new Set(roomAgents.map((a) => a.id))

    for (const agentId of uniqueAgentIds) {
      if (!roomAgentIds.has(agentId)) continue
      const agent = roomAgents.find((a) => a.id === agentId)
      if (!agent) continue

      this.broadcastToRoom(roomId, {
        msgId: uuidv4(),
        roomId,
        type: 'broadcast',
        action: 'agent.status_update',
        payload: { agentId, status: 'working', onlineStatus: 'working', lastActiveAt: Date.now() },
        timestamp: Date.now()
      })

      try {
        await agentService.updateAgent(agentId, { status: 'working' } as any)
        const contentWithFiles = `${content}${await fileMentionContextService.build(roomId, mentions)}`
        const timeoutMs = receiptReason === 'task' ? config.agent.taskTimeoutMs : config.agent.chatTimeoutMs
        const result = await agentService.spawnClaudeCode(roomId, agentId, contentWithFiles, { timeoutMs })
        const completed = receiptReason === 'task' ? await agentTaskCompletionService.autoCompleteFromRun(content, result.response || '') : null
        if (completed) this.broadcastToRoom(roomId, { msgId: uuidv4(), roomId, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task: completed.task }, timestamp: Date.now() })
        await agentService.updateAgent(agentId, { status: 'active' } as any)

        this.broadcastToRoom(roomId, {
          msgId: uuidv4(),
          roomId,
          type: 'broadcast',
          action: 'agent.status_update',
          payload: { agentId, status: 'active', onlineStatus: 'online', lastActiveAt: Date.now() },
          timestamp: Date.now()
        })

        if (completed?.released?.length) for (const item of completed.released) {
          if (item.assigneeType === 'agent' && item.assigneeId) void this.invokeMentionedAgents(roomId, `前置子任务已完成，你负责的子任务已解除阻塞，请立即处理。\n父任务ID: ${completed.task.id}\n父任务标题: ${completed.task.title}\n子任务ID: ${item.id}\n子任务标题: ${item.title}\n${item.description ? `子任务说明: ${item.description}` : ''}\n请先用 ./freechat task subtask update 标记状态/进展，完成后在聊天中简短汇报。`, [{ id: item.assigneeId, name: item.assigneeName || 'Agent', role: 'ai' }], 'task')
        }

        if (result.silent || !result.response) continue

        const responseMsg = await messageService.createMessage(
          roomId,
          agentId,
          agent.name,
          'ai',
          result.response
        )

        this.broadcastToRoom(roomId, {
          msgId: responseMsg.id,
          roomId,
          type: 'broadcast',
          action: 'chat.message',
          payload: responseMsg,
          timestamp: Date.now()
        })
      } catch (err: any) {
        const message = err?.message || String(err)
        const isTimeout = /timed out|timeout/i.test(message)
        await agentService.updateAgent(agentId, { status: isTimeout ? 'active' : 'error' } as any).catch(() => {})
        this.broadcastToRoom(roomId, {
          msgId: uuidv4(),
          roomId,
          type: 'broadcast',
          action: 'agent.status_update',
          payload: { agentId, status: isTimeout ? 'active' : 'error', onlineStatus: isTimeout ? 'online' : 'error', lastActiveAt: Date.now(), lastError: message },
          timestamp: Date.now()
        })
        console.error(`Agent ${agentId} invocation failed:`, err)
      }
    }
  }
}
