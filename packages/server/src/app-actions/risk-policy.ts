import { getAppAction, type AppActionRisk } from './registry.js'
import type { ToolExecutionContext } from './types.js'

const DEFAULT_RISK_BY_DOMAIN: Record<string, AppActionRisk> = {
  tool: 'read',
  app: 'normal_write',
  chat: 'normal_write',
  task: 'normal_write',
  file: 'normal_write',
  pdf: 'read',
  excel: 'normal_write',
  word: 'normal_write',
  ppt: 'normal_write',
  image: 'read',
  mindmap: 'normal_write',
  tab: 'normal_write',
  members: 'sensitive_write',
  profiles: 'sensitive_write',
  users: 'read',
  agent: 'normal_write',
  scene: 'normal_write',
  interaction: 'normal_write',
  conversation: 'normal_write',
  friends: 'sensitive_write',
  dm: 'dangerous',
  room: 'sensitive_write',
  billing: 'read',
  model: 'read',
}

const SENSITIVE_ACTIONS = new Set([
  'file.delete', 'tab.delete', 'task.delete',
  'members.add', 'profiles.update',
  'agent.add', 'agent.remove', 'agent.restart',
  'agent.skill.create', 'agent.skill.update', 'agent.skill.delete',
  'agent.script.create', 'agent.script.update', 'agent.script.delete',
  'agent.knowledge.delete',
  'room.update', 'room.create-invite',
  'friends.request', 'friends.accept', 'friends.reject',
])

const DANGEROUS_ACTIONS = new Set([
  'room.delete', 'dm.send', 'ai.api-key.update', 'user.password.update',
])

export function canonicalizeToolAction(action: string): string {
  const raw = String(action || '').trim()
  if (raw === 'agent.create_request') return 'agent.create-request'
  if (raw === 'agent.my_list') return 'agent.my-list'
  if (raw === 'agent.room_list') return 'agent.room-list'
  return raw
}

export function riskForAction(action: string): AppActionRisk {
  const canonical = canonicalizeToolAction(action)
  const meta = getAppAction(canonical)
  if (meta?.risk) return meta.risk
  if (DANGEROUS_ACTIONS.has(canonical)) return 'dangerous'
  if (SENSITIVE_ACTIONS.has(canonical)) return 'sensitive_write'
  const domain = canonical.split('.')[0] || ''
  return DEFAULT_RISK_BY_DOMAIN[domain] || 'normal_write'
}

export function assertRiskAllowed(ctx: ToolExecutionContext, risk: AppActionRisk) {
  if (!ctx.actorUserId) throw { code: 'ACTOR_REQUIRED', message: 'Tool execution requires actorUserId' }
  if (risk === 'blocked') throw { code: 'TOOL_BLOCKED', message: `Tool is blocked: ${ctx.action}` }
  if (risk === 'dangerous') throw { code: 'TOOL_REQUIRES_CONFIRMATION', message: `Dangerous tool requires explicit confirmation: ${ctx.action}` }
}

export function isReadOnlyRisk(risk: AppActionRisk) {
  return risk === 'read'
}
