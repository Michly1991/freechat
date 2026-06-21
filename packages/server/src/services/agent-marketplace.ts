import type { Agent } from '@freechat/shared'

const MARKETPLACE_AGENTS: Agent[] = [
  {
    id: 'market_code_reviewer',
    name: 'Code Reviewer',
    roleType: 'specialist',
    deployment: 'client',
    description: 'Reviews code for bugs, style issues, performance, and security vulnerabilities.',
    specialties: ['code-review', 'security', 'best-practices'],
    status: 'active',
  },
  {
    id: 'market_tech_writer',
    name: 'Tech Writer',
    roleType: 'specialist',
    deployment: 'client',
    description: 'Writes clear technical documentation, READMEs, and API references.',
    specialties: ['documentation', 'writing', 'api-docs'],
    status: 'active',
  },
  {
    id: 'market_task_master',
    name: 'Task Master',
    roleType: 'assistant',
    deployment: 'client',
    description: 'Breaks down complex tasks into subtasks, tracks progress, and coordinates work.',
    specialties: ['project-management', 'task-planning', 'coordination'],
    status: 'active',
  },
  {
    id: 'market_researcher',
    name: 'Research Assistant',
    roleType: 'specialist',
    deployment: 'client',
    description: 'Searches the web, summarizes findings, and compiles research reports.',
    specialties: ['research', 'summarization', 'web-search'],
    status: 'active',
  },
  {
    id: 'market_debugger',
    name: 'Debugger',
    roleType: 'specialist',
    deployment: 'client',
    description: 'Expert at diagnosing and fixing bugs across multiple languages and frameworks.',
    specialties: ['debugging', 'troubleshooting', 'fixes'],
    status: 'active',
  },
]

export function searchMarketplaceAgents(query?: string): Agent[] {
  if (!query) return MARKETPLACE_AGENTS

  const q = query.toLowerCase()
  return MARKETPLACE_AGENTS.filter(a =>
    a.name.toLowerCase().includes(q) ||
    a.description?.toLowerCase().includes(q) ||
    a.specialties?.some(s => s.toLowerCase().includes(q))
  )
}
