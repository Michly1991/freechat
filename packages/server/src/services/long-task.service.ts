import { taskService } from './task.service.js'
import { taskItemService, type TaskItem } from './task-item.service.js'
import { aiConfigService } from './ai-config.service.js'
import { config } from '../config.js'

export interface LongTaskDecision {
  mode: 'chat' | 'long_task'
  confidence?: number
  reason?: string
  title?: string
  artifactRoot?: string
  items?: Array<{
    title: string
    description?: string
    artifactPath?: string
  }>
}

export interface LongTaskPlanResult {
  task: any
  subtasks: TaskItem[]
  firstSubtask?: TaskItem
  summaryMessage: string
  wakePrompt?: string
}

function extractJson(text: string): any | null {
  const raw = String(text || '').trim()
  try { return JSON.parse(raw) } catch {}
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch { return null }
}

function cleanName(text: string, fallback: string) {
  const value = String(text || fallback || '').replace(/\s+/g, ' ').trim()
  return value.slice(0, 60) || fallback
}

function safeRoot(text: string) {
  return `res/${cleanName(text, 'long-task').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'long-task'}`
}

function normalizeDecision(input: any): LongTaskDecision {
  const mode = input?.mode === 'long_task' ? 'long_task' : 'chat'
  const title = cleanName(input?.title, '长任务处理')
  const artifactRoot = input?.artifactRoot ? String(input.artifactRoot).trim() : safeRoot(title)
  const items = Array.isArray(input?.items)
    ? input.items
      .map((item: any) => ({
        title: cleanName(item?.title, ''),
        description: item?.description ? String(item.description).trim() : undefined,
        artifactPath: item?.artifactPath ? String(item.artifactPath).trim() : undefined,
      }))
      .filter((item: any) => item.title)
      .slice(0, 12)
    : []
  return {
    mode,
    confidence: Number(input?.confidence || 0),
    reason: input?.reason ? String(input.reason).slice(0, 240) : undefined,
    title,
    artifactRoot,
    items,
  }
}

export class LongTaskService {
  async decideWithAgent(roomId: string, assistant: { id: string; name: string }, content: string, context = '', actorUserId?: string): Promise<LongTaskDecision> {
    const prompt = `你是当前协调者的执行调度判断器。请只判断“最新用户消息”应该普通聊天处理，还是应该拆成现有任务体系中的长任务。

不要执行任务，不要写正文，不要调用工具。只输出 JSON。

判断原则：
- 如果用户只是普通问答、短回复、澄清、小修改，mode=chat。
- 如果预计需要多步骤、多个文件、较长输出、整理大量上下文、或用户是在继续一个已经很长/失败/超时的任务，mode=long_task。
- 如果 mode=long_task，请给出 3-8 个串行子任务；每个子任务必须有明确产物，优先给 artifactPath。
- 子任务要小，失败时只影响当前子任务。

JSON 格式：
{
  "mode": "chat" | "long_task",
  "confidence": 0.0,
  "reason": "简短原因",
  "title": "父任务标题",
  "artifactRoot": "res/可读目录名",
  "items": [
    { "title": "子任务标题", "description": "只处理该步骤的说明", "artifactPath": "res/目录/文件.md" }
  ]
}

最近上下文：
${context.slice(-5000)}

最新用户消息：
${content}
`
    try {
      const response = await this.callPlannerProvider(prompt)
      const json = extractJson(response)
      if (!json) return { mode: 'chat', confidence: 0, reason: 'planner returned non-json' }
      const decision = normalizeDecision(json)
      if (decision.mode === 'long_task' && decision.items && decision.items.length > 0) return decision
      return { ...decision, mode: 'chat' }
    } catch (err: any) {
      return { mode: 'chat', confidence: 0, reason: `planner failed fast: ${err?.message || String(err)}` }
    }
  }

  private async callPlannerProvider(prompt: string): Promise<string> {
    const provider = aiConfigService.getCurrentProvider()
    const apiKey = aiConfigService.getApiKey(aiConfigService.getConfig().currentProvider)
    if (!provider || !apiKey || !provider.enabled) throw new Error('AI provider not configured')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.agent.deciderTimeoutMs)
    try {
      const response = await fetch(`${provider.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [provider.apiKeyHeader]: apiKey,
          'anthropic-version': '2023-06-01'
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: provider.defaultModel,
          max_tokens: 768,
          messages: [{ role: 'user', content: prompt }]
        })
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({})) as any
        throw new Error(`planner API error: ${err.message || err.code || response.statusText}`)
      }
      const data = await response.json() as any
      return data.content?.[0]?.text || ''
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new Error(`planner timed out after ${config.agent.deciderTimeoutMs}ms`)
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  async createPlan(roomId: string, userId: string | undefined, assistant: { id: string; name: string }, content: string, context: string, decision: LongTaskDecision): Promise<LongTaskPlanResult> {
    const title = cleanName(decision.title || '', '长任务处理')
    const root = decision.artifactRoot || safeRoot(title)
    const items = (decision.items || []).length > 0 ? decision.items! : [
      { title: '整理上下文与目标', description: `整理现有信息、目标和缺口，保存到 ${root}/00-上下文.md`, artifactPath: `${root}/00-上下文.md` },
      { title: '分步处理核心内容', description: `处理主要内容并保存到 ${root}/01-核心内容.md`, artifactPath: `${root}/01-核心内容.md` },
      { title: '最终汇总', description: `生成最终汇总，保存到 ${root}/99-最终汇总.md`, artifactPath: `${root}/99-最终汇总.md` },
    ]

    const task = await taskService.createTask(
      roomId,
      title,
      [
        '[LONG_TASK]',
        decision.reason ? `判断原因：${decision.reason}` : '',
        `原始需求：${content}`,
        `产物目录：${root}`,
        '执行方式：由协调者判断后拆分为串行子任务；每步独立落盘；失败只影响当前子任务，可单独重试。',
      ].filter(Boolean).join('\n'),
      'medium',
      assistant.id,
      assistant.name,
      'agent',
      userId
    )

    const subtasks: TaskItem[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const prev = subtasks[i - 1]
      const description = [
        item.description || '',
        item.artifactPath ? `产物路径：${item.artifactPath}` : '',
      ].filter(Boolean).join('\n')
      const subtask = await taskItemService.create(task.id, {
        title: item.title,
        description,
        status: i === 0 ? 'assigned' : 'blocked',
        assigneeId: assistant.id,
        assigneeName: assistant.name,
        assigneeType: 'agent',
        blockedReason: i === 0 ? undefined : '等待前置子任务完成',
        createdBy: userId || assistant.id,
      })
      if (prev) taskItemService.addDependency(subtask.id, prev.id)
      subtasks.push(subtask)
    }

    const firstSubtask = subtasks[0]
    return {
      task: await taskService.getTask(task.id),
      subtasks,
      firstSubtask,
      summaryMessage: [
        '这是一个长任务，我已让协调者先判断并拆成串行子任务。',
        '',
        `父任务：${task.title}`,
        `产物目录：${root}`,
        '',
        ...subtasks.map((item, i) => `${i + 1}. ${item.title}`),
        '',
        '我会逐步执行；如果某一步超时，只需要重试该子任务，前面已完成内容不会丢。',
      ].join('\n'),
      wakePrompt: firstSubtask ? this.buildWakePrompt(task, firstSubtask, content, context, root) : undefined,
    }
  }

  private buildWakePrompt(task: any, subtask: TaskItem, content: string, context: string, root: string) {
    return [
      '这是一个长任务子任务，请只处理当前子任务，不要一次性完成全部任务。',
      `父任务ID: ${task.id}`,
      `父任务标题: ${task.title}`,
      `子任务ID: ${subtask.id}`,
      `子任务标题: ${subtask.title}`,
      subtask.description ? `子任务说明: ${subtask.description}` : '',
      `产物目录: ${root}`,
      '',
      `用户原始需求：${content}`,
      context ? `\n最近上下文：\n${context.slice(-3000)}` : '',
      '',
      '要求：',
      '1. 先用 ./freechat task subtask update 标记当前子任务 doing。',
      '2. 只完成当前子任务，必须先写入本地 res/，再用 ./freechat file write-local <项目文件路径> <本地文件路径> --show 发布到项目文件目录。',
      '3. 注意：直接写 res/ 只是在 Agent 私有工作区，用户文件目录看不到；必须通过 ./freechat file write-local 或 ./freechat file write 才算交付。',
      '4. 完成后用 ./freechat task subtask update 标记 done，或在输出中明确“已完成/已保存”。',
      '5. 聊天回复只给简短摘要、项目文件路径和下一步。',
    ].filter(Boolean).join('\n')
  }
}

export const longTaskService = new LongTaskService()
