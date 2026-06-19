import { v4 as uuidv4 } from 'uuid'
import { agentService } from '../services/agent.service.js'
import { interactionService } from '../services/interaction.service.js'
import { messageService } from '../services/message.service.js'
import { agentTaskCompletionService } from '../services/agent-task-completion.service.js'
import { agentArtifactService } from '../services/agent-artifact.service.js'
import { fileMentionContextService } from '../services/file-mention-context.service.js'
import { longTaskService } from '../services/long-task.service.js'
import { config } from '../config.js'
import { buildAssistantAutoPrompt, shouldConsiderAssistantAutoReply } from './assistant-auto-prompt.js'
import type { BroadcastToRoom, InvokeReason } from './gateway-types.js'
import { clearActiveAgentStream, setActiveAgentStream } from './agent-stream-events.js'
import { agentStreamService } from '../services/agent-stream.service.js'
import db from '../storage/db.js'

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

  private getRoomCreator(roomId: string): string | null {
    const row = db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(roomId) as any
    return row?.created_by || null
  }

  private isCreatorCommand(roomId: string, actorUserId?: string): boolean {
    const creatorId = this.getRoomCreator(roomId)
    return !!creatorId && !!actorUserId && actorUserId === creatorId
  }

  private async sendCommandDenied(roomId: string, actorUserId?: string) {
    const creatorId = this.getRoomCreator(roomId)
    const creator = creatorId ? db.prepare('SELECT nickname, username FROM users WHERE id = ?').get(creatorId) as any : null
    const creatorName = creator?.nickname || creator?.username || '项目创建人'
    const msg = await messageService.createMessage(roomId, 'system', '系统', 'ai', `只有项目创建人「${creatorName}」可以指挥 Agent；本项目的 Agent 和模型运行费用也由创建人承担。`, undefined, undefined, 'system_notice', { reason: 'creator_only_agent_command', actorUserId, payerUserId: creatorId })
    this.broadcastToRoom(roomId, { msgId: msg.id, roomId, type: 'broadcast', action: 'chat.message', payload: msg, timestamp: Date.now() })
  }

  async maybeAutoInvokeAssistant(roomId: string, actorName: string, content: string, mentions: any[] = [], actorUserId?: string) {
    if (!this.isCreatorCommand(roomId, actorUserId)) return
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

    const contentWithFiles = `${content}${await fileMentionContextService.build(roomId, mentions)}`
    const decision = pendingInteractions.length === 0 ? await longTaskService.decideWithAgent(roomId, assistant, contentWithFiles, context, actorUserId) : { mode: 'chat' as const }
    if (decision.mode === 'long_task') {
      const plan = await longTaskService.createPlan(roomId, actorUserId, assistant, contentWithFiles, context, decision)
      const responseMsg = await messageService.createMessage(roomId, assistant.id, assistant.name, 'ai', plan.summaryMessage)
      this.broadcastToRoom(roomId, { msgId: responseMsg.id, roomId, type: 'broadcast', action: 'chat.message', payload: responseMsg, timestamp: Date.now() })
      this.broadcastToRoom(roomId, { msgId: uuidv4(), roomId, type: 'broadcast', action: 'task.changed', payload: { action: 'add', task: plan.task }, timestamp: Date.now() })
      if (plan.wakePrompt && plan.firstSubtask) {
        void this.invokeMentionedAgents(roomId, plan.wakePrompt, [{ id: assistant.id, name: assistant.name, role: 'ai' }], 'task', actorUserId)
      }
      return
    }

    const prompt = buildAssistantAutoPrompt({
      context,
      actorName,
      content: contentWithFiles,
      pendingInteractions: pendingInteractions.map((item) => ({ id: item.id, type: item.type, title: item.title, description: item.description })),
    })

    await this.invokeMentionedAgents(roomId, prompt, [{ id: assistant.id, name: assistant.name, role: 'ai' }], 'auto', actorUserId)
  }

  async invokeMentionedAgents(roomId: string, content: string, mentions: any[], receiptReason: InvokeReason = 'mention', actorUserId?: string) {
    const agentMentions = mentions.filter((m) => m?.role === 'ai' && m?.id)
    if (agentMentions.length === 0) return
    if (!this.isCreatorCommand(roomId, actorUserId)) {
      if (receiptReason === 'mention') await this.sendCommandDenied(roomId, actorUserId)
      return
    }

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
      const streamMessage = agentStreamService.createStream(roomId, agentId, agent.name)
      const streamMessageId = streamMessage.id
      setActiveAgentStream(roomId, agentId, streamMessageId)
      const streamStartedAt = streamMessage.createdAt
      this.broadcastToRoom(roomId, {
        msgId: streamMessageId,
        roomId,
        type: 'broadcast',
        action: 'agent.stream.started',
        payload: streamMessage,
        timestamp: streamStartedAt
      })
      let activityTick = 0
      const activityTimer = setInterval(() => {
        activityTick += 1
        const activity = agentStreamService.addActivity(streamMessageId, { kind: 'heartbeat', text: activityTick === 1 ? '正在思考并检查上下文' : `仍在处理，已用时 ${Math.round((Date.now() - streamStartedAt) / 1000)} 秒` })
        this.broadcastToRoom(roomId, {
          msgId: uuidv4(),
          roomId,
          type: 'broadcast',
          action: 'agent.stream.activity',
          payload: { id: streamMessageId, agentId, ...activity },
          timestamp: Date.now()
        })
      }, 8000)

      try {
        await agentService.updateAgent(agentId, { status: 'working' } as any)
        const selfMentionContext = agentMentions.some((m) => m.id === agentId)
          ? `用户明确 @ 了你本人（${agent.name}, ${agent.id}）。你就是被 @ 的 Agent；不要转发、通知或提醒同名 Agent，请直接处理用户请求。\n\n`
          : ''
        const contentWithFiles = `${selfMentionContext}${content}${await fileMentionContextService.build(roomId, mentions)}`
        const timeoutMs = receiptReason === 'task' ? config.agent.taskTimeoutMs : config.agent.chatTimeoutMs
        const runtimeActivity = agentStreamService.addActivity(streamMessageId, { text: '正在调用 Agent Runtime' })
        this.broadcastToRoom(roomId, { msgId: uuidv4(), roomId, type: 'broadcast', action: 'agent.stream.activity', payload: { id: streamMessageId, agentId, ...runtimeActivity }, timestamp: Date.now() })
        const result = await agentService.spawnClaudeCode(roomId, agentId, contentWithFiles, {
          timeoutMs,
          actorUserId,
          onEvent: (event) => {
            if (event.type === 'delta') {
              this.broadcastToRoom(roomId, { msgId: uuidv4(), roomId, type: 'broadcast', action: 'agent.stream.delta', payload: { id: streamMessageId, agentId, content: event.text }, timestamp: Date.now() })
              return
            }
            const activity = agentStreamService.addActivity(streamMessageId, { kind: event.kind, text: event.text, tool: event.tool })
            this.broadcastToRoom(roomId, { msgId: uuidv4(), roomId, type: 'broadcast', action: 'agent.stream.activity', payload: { id: streamMessageId, agentId, ...activity }, timestamp: Date.now() })
          }
        })
        if (receiptReason === 'task') await agentArtifactService.publishDeclaredArtifacts(roomId, agentId, content)
        const completed = receiptReason === 'task' ? await agentTaskCompletionService.autoCompleteFromRun(content, result.response || '') : null
        if (completed) this.broadcastToRoom(roomId, { msgId: uuidv4(), roomId, type: 'broadcast', action: 'task.changed', payload: { action: 'update', task: completed.task }, timestamp: Date.now() })
        await agentService.updateAgent(agentId, { status: 'active' } as any)
        clearInterval(activityTimer)

        this.broadcastToRoom(roomId, {
          msgId: uuidv4(),
          roomId,
          type: 'broadcast',
          action: 'agent.status_update',
          payload: { agentId, status: 'active', onlineStatus: 'online', lastActiveAt: Date.now() },
          timestamp: Date.now()
        })

        if (completed?.released?.length) for (const item of completed.released) {
          if (item.assigneeType === 'agent' && item.assigneeId) void this.invokeMentionedAgents(roomId, `前置子任务已完成，你负责的子任务已解除阻塞，请立即处理。\n父任务ID: ${completed.task.id}\n父任务标题: ${completed.task.title}\n子任务ID: ${item.id}\n子任务标题: ${item.title}\n${item.description ? `子任务说明: ${item.description}` : ''}\n请先用 ./freechat task subtask update 标记状态/进展，完成后在聊天中简短汇报。`, [{ id: item.assigneeId, name: item.assigneeName || 'Agent', role: 'ai' }], 'task', actorUserId)
        }

        if (result.silent || !result.response) {
          agentStreamService.completeStream(streamMessageId, undefined, true)
          this.broadcastToRoom(roomId, { msgId: uuidv4(), roomId, type: 'broadcast', action: 'agent.stream.completed', payload: { id: streamMessageId, agentId, silent: true, content: '' }, timestamp: Date.now() })
          clearActiveAgentStream(roomId, agentId, streamMessageId)
          continue
        }

        const activities = agentStreamService.getActivities(streamMessageId)
        const responseMsg = await messageService.createMessage(
          roomId,
          agentId,
          agent.name,
          'ai',
          result.response,
          undefined,
          undefined,
          'text',
          { agentStream: { id: streamMessageId, activities } }
        )
        agentStreamService.completeStream(streamMessageId, responseMsg.id)

        this.broadcastToRoom(roomId, { msgId: uuidv4(), roomId, type: 'broadcast', action: 'agent.stream.completed', payload: { id: streamMessageId, agentId, finalMessageId: responseMsg.id, content: result.response, activities }, timestamp: Date.now() })
        this.broadcastToRoom(roomId, {
          msgId: responseMsg.id,
          roomId,
          type: 'broadcast',
          action: 'chat.message',
          payload: responseMsg,
          timestamp: Date.now()
        })
        clearActiveAgentStream(roomId, agentId, streamMessageId)
      } catch (err: any) {
        clearInterval(activityTimer)
        const message = err?.message || String(err)
        const isTimeout = /timed out|timeout/i.test(message)
        const isForcedStop = err?.code === 'AGENT_FORCE_STOPPED' || /force restarted|强制重启/i.test(message)
        const isBillingBlock = err?.code === 'INSUFFICIENT_CREDITS'
        const recoverable = isTimeout || isForcedStop || isBillingBlock
        await agentService.updateAgent(agentId, { status: recoverable ? 'active' : 'error' } as any).catch(() => {})
        this.broadcastToRoom(roomId, {
          msgId: uuidv4(),
          roomId,
          type: 'broadcast',
          action: 'agent.status_update',
          payload: { agentId, status: recoverable ? 'active' : 'error', onlineStatus: recoverable ? 'online' : 'error', lastActiveAt: Date.now(), lastError: isForcedStop || isBillingBlock ? null : message },
          timestamp: Date.now()
        })
        agentStreamService.failStream(streamMessageId, message)
        this.broadcastToRoom(roomId, { msgId: uuidv4(), roomId, type: 'broadcast', action: 'agent.stream.failed', payload: { id: streamMessageId, agentId, error: message }, timestamp: Date.now() })
        clearActiveAgentStream(roomId, agentId, streamMessageId)
        console.error(`Agent ${agentId} invocation failed:`, err)
      }
    }
  }
}
