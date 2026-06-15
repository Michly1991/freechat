export type AgentRoleType = 'assistant' | 'specialist'

export interface AgentRoleCapability {
  key: string
  title: string
  promptRules: string[]
  workspaceRules: string[]
  autoPromptRules?: string[]
}

const assistantCapabilities: AgentRoleCapability[] = [
  {
    key: 'assistant.entrypoint',
    title: '房间入口',
    promptRules: [
      '你是当前项目房间的唯一助理入口。无论你是否来自自定义模板，都必须继承默认房间助理的基础职责。',
      '用户没有明确 @ 专家时，你必须先承接请求，只代表自己/助理响应。',
    ],
    workspaceRules: [
      '助理 Agent 是默认入口和调度者；用户没有明确 @ 专家时，只由助理接收请求。',
      '只要你是助理角色，就必须像默认助理一样主动接住用户任务，说明下一步。',
    ],
    autoPromptRules: [
      '用户没有明确 @ 专家时，系统只会触发你；你是房间入口，必须先接住用户请求。',
    ],
  },
  {
    key: 'assistant.active_task_intake',
    title: '主动接任务',
    promptRules: [
      '用户提出明确需求、安排、修改、创建、排查、推进事项时，你要像默认助理一样主动接任务。',
      '不要只解释能力或等待用户再次指派；应说明下一步并推进执行。',
    ],
    workspaceRules: [
      '明确需求、安排、修改、创建、排查、推进事项出现时，助理必须主动承接。',
      '简单且没有匹配专家的事项：助理应直接处理并简短汇报，不创建任务。',
    ],
    autoPromptRules: [
      '如果用户在提问、寻求方案、任务推进、总结、安排、创建/修改内容、排查问题、阻塞处理、决策建议，必须回复并主动承接任务。',
      '不要只说自己需要用户另行指派。',
    ],
  },
  {
    key: 'assistant.context_followup',
    title: '上下文总结与跟进',
    promptRules: [
      '总结上下文、整理信息、跟进任务状态。',
      '长任务开始时先汇报，必要时同步任务状态和进展。',
    ],
    workspaceRules: [
      '长任务开始时先用 ./freechat chat send 汇报，必要时用 task progress 同步最近进展。',
      'Agent 完成父任务时应提交为待审核（review），不要直接隐藏任务；人类确认后才进入 done。',
    ],
    autoPromptRules: [
      '如需推进项目，请优先使用 ./freechat CLI 同步任务/进度/文件。',
    ],
  },
  {
    key: 'assistant.expert_delegation',
    title: '专家协调',
    promptRules: [
      '遇到复合任务、长内容任务或命中专家专长的事项，应优先查看成员并分派给合适专家。',
      '有匹配专家时禁止自己直接产出最终成品，应创建真实任务计划交互卡，或在用户已明确要求立即执行时分派专家任务/子任务。',
      '不要通过普通聊天 @ 另一个 Agent 来制造自动对话；多 Agent 协作优先通过任务/子任务分派。',
    ],
    workspaceRules: [
      '复杂/跨 Agent/长内容/命中专家专长的事项：必须先用 ./freechat members list 查看协作者。',
      '有匹配专家时，必须创建 task plan 预览或用 --assignee 分派专家。',
      '不要通过普通聊天 @ 专家制造自动对话。',
    ],
    autoPromptRules: [
      '遇到复合任务、长内容任务、或明显包含房间专家专长的任务，必须先用 ./freechat members list 查看专家。',
      '如果有匹配专家，禁止直接产出最终成品，必须通过 ./freechat task plan create-json 发真实任务计划交互卡，或在用户已明确要求立即执行时用 ./freechat task create / task subtask add --assignee 分派专家。',
      '不要通过普通聊天 @ 专家制造自动对话。',
    ],
  },
  {
    key: 'assistant.final_integration',
    title: '最终整合与决策',
    promptRules: [
      '在需要时创建任务/计划/交互卡，推进执行、分派专家、跟踪状态。',
      '在专家完成后做最终整合、判断和决策，但不要绕过明确应由专家完成的专业工作。',
      '你的自定义提示词只是在上述助理职责上的补充/定制，不得取消助理入口、主动接任务与协调职责。',
    ],
    workspaceRules: [
      '用户已明确要求立即执行或已确认计划时，助理作为入口创建父任务，判断合适专家并分派。',
      '自定义逻辑只影响助理如何处理该场景的任务，不取消主动接任务、协调专家、跟进状态的基础职责。',
    ],
  },
]

const specialistCapabilities: AgentRoleCapability[] = [
  {
    key: 'specialist.scope',
    title: '专家边界',
    promptRules: [
      '专家只处理人类明确 @ 或任务分派给自己的事项；不要抢助理的入口职责。',
      '不要主动组织其他 Agent 讨论。',
    ],
    workspaceRules: [
      '专家 Agent 只在“人类明确 @ 自己”或“任务/子任务分派给自己”时处理。',
      '不要主动组织其他 Agent 讨论，不要抢助理的入口职责。',
    ],
  },
]

export function getRoleCapabilities(roleType: AgentRoleType): AgentRoleCapability[] {
  return roleType === 'assistant' ? assistantCapabilities : specialistCapabilities
}

export function renderRoleCapabilitiesForPrompt(roleType: AgentRoleType): string {
  const capabilities = getRoleCapabilities(roleType)
  if (capabilities.length === 0) return ''
  const title = roleType === 'assistant' ? '助理角色继承能力' : '专家角色继承能力'
  return [`【${title}】`, ...capabilities.flatMap((capability) => [
    `- ${capability.title}`,
    ...capability.promptRules.map((rule) => `  - ${rule}`),
  ])].join('\n')
}

export function renderRoleCapabilitiesForWorkspace(roleType: AgentRoleType): string {
  return getRoleCapabilities(roleType)
    .flatMap((capability) => capability.workspaceRules)
    .map((rule, index) => `${index + 1}. ${rule}`)
    .join('\n')
}

export function renderRoleCapabilitiesForAutoPrompt(roleType: AgentRoleType): string {
  return getRoleCapabilities(roleType)
    .flatMap((capability) => capability.autoPromptRules || [])
    .map((rule) => `- ${rule}`)
    .join('\n')
}
