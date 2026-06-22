export type AgentToolKey = 'chat' | 'task' | 'file' | 'tab' | 'interaction' | 'members'

export interface AgentFormState {
  name: string
  description: string
  specialties: string
  systemPrompt: string
  agentMarkdown: string
  tools: Record<AgentToolKey, boolean>
}

export const AGENT_TOOL_KEYS: AgentToolKey[] = ['chat', 'task', 'file', 'tab', 'interaction', 'members']

export function emptyAgentForm(): AgentFormState {
  return {
    name: '',
    description: '',
    specialties: '',
    systemPrompt: '',
    agentMarkdown: '',
    tools: { chat: true, task: true, file: true, tab: true, interaction: true, members: true },
  }
}

export function agentToForm(agent: any): AgentFormState {
  return {
    name: agent.name || '',
    description: agent.description || '',
    specialties: (agent.specialties || []).join(', '),
    systemPrompt: agent.config?.systemPrompt || '',
    agentMarkdown: agent.agentMarkdown || agent.config?.agentMarkdown || '',
    tools: { ...emptyAgentForm().tools, ...(agent.config?.tools || {}) },
  }
}

export function buildAgentPayload(form: AgentFormState) {
  return {
    name: form.name.trim(),
    deployment: 'client' as const,
    description: form.description,
    specialties: form.specialties.split(',').map((s) => s.trim()).filter(Boolean),
    config: {
      systemPrompt: form.systemPrompt,
      agentMarkdown: form.agentMarkdown,
      behavior: { replyMode: 'mention_only', silentAllowed: true },
      tools: form.tools,
    },
  }
}
