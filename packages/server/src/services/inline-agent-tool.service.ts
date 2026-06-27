import db from '../storage/db.js'
import { agentService } from './agent.service.js'
import { interactionService } from './interaction.service.js'
import { broadcast, assertActorCanUseAgentInRoom } from '../routes/agent-tools.helpers.js'
import { agentCapabilityService } from './agent-capability.service.js'

type ToolCall = { name: string; args: any }

function tryParseJson(text: string): any | null {
  try { return JSON.parse(text) } catch { return null }
}

export function extractInlineToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = []
  const markerRe = /<\|FunctionCallBegin\|>([\s\S]*?)<\|FunctionCallEnd\|>/g
  for (const match of text.matchAll(markerRe)) {
    const parsed = tryParseJson(match[1].trim())
    if (Array.isArray(parsed)) {
      for (const item of parsed) if (item?.name) calls.push({ name: String(item.name), args: item.args || {} })
    } else if (parsed?.name) calls.push({ name: String(parsed.name), args: parsed.args || {} })
  }
  const toolCallRe = /<toolcall>([\s\S]*?)<\/toolcall>/g
  for (const match of text.matchAll(toolCallRe)) {
    const parsed = tryParseJson(match[1].trim())
    if (parsed?.name) calls.push({ name: String(parsed.name), args: parsed.args || parsed.params || {} })
    else if (parsed?.action || parsed?.tool) calls.push({ name: String(parsed.action || parsed.tool), args: parsed.args || parsed.params || {} })
  }
  const codeRe = /```(?:json)?\s*([\s\S]*?)```/g
  for (const match of text.matchAll(codeRe)) {
    const parsed = tryParseJson(match[1].trim())
    if (parsed?.action || parsed?.tool) calls.push({ name: String(parsed.action || parsed.tool), args: parsed.args || {} })
  }
  return calls.slice(0, 5)
}

function assertActorInRoom(roomId: string, actorUserId: string) {
  const row = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, actorUserId)
  if (!row) throw new Error('Current user is not a member of this room')
}

function sanitizeAgentForInline(agent: any) {
  if (!agent) return null
  return {
    id: agent.id,
    name: agent.name,
    roleType: agent.roleType,
    deployment: agent.deployment,
    description: agent.description,
    specialties: agent.specialties || [],
    status: agent.status,
    onlineStatus: agent.onlineStatus,
    roomRole: agent.roomRole,
    autoEnabled: agent.autoEnabled,
    ownerName: agent.ownerName,
    isTemplate: agent.isTemplate,
    sourceTemplateId: agent.sourceTemplateId,
    marketListed: agent.marketListed,
    model: agent.roomModelConfig || agent.defaultModelConfig || undefined,
  }
}

function summarizeAgent(agent: any) {
  const parts = [agent.name]
  if (agent.description) parts.push(`：${agent.description}`)
  if (Array.isArray(agent.specialties) && agent.specialties.length) parts.push(`（${agent.specialties.slice(0, 4).join('、')}）`)
  return parts.join('')
}

function formatToolResult(action: string, result: any) {
  if (action === 'agent.my-list') {
    const agents = result?.data?.agents || result?.agents || []
    if (!agents.length) return '你当前还没有可用的 Agent。'
    return `你当前可用/可见的 Agent 有：\n${agents.map((agent: any, i: number) => `${i + 1}. ${summarizeAgent(agent)}`).join('\n')}`
  }
  if (action === 'agent.list-available') {
    const agents = result?.data?.agents || result?.agents || []
    if (!agents.length) return '没查到你当前可用的 Agent。'
    return `你当前可用的 Agent 有：\n${agents.map((agent: any, i: number) => `${i + 1}. ${summarizeAgent(agent)}`).join('\n')}`
  }
  if (action === 'agent.create_request' || action === 'agent.create-request' || action === 'agent.create') {
    const interaction = result?.data?.interaction || result?.interaction
    return `已创建确认卡：${interaction?.title || '确认创建 Agent'}。请在房间中点击确认后，系统会创建并加入该 Agent。`
  }
  if (action === 'agent.detail') {
    const agent = result?.data?.agent || result?.agent
    const skills = result?.data?.skills || []
    const scripts = result?.data?.scripts || []
    if (!agent) return '没有查到该 Agent。'
    return [
      `Agent：${agent.name}`,
      agent.description ? `职责：${agent.description}` : '',
      Array.isArray(agent.specialties) && agent.specialties.length ? `专长：${agent.specialties.join('、')}` : '',
      `类型：${agent.roleType || 'unknown'}，状态：${agent.onlineStatus || agent.status || 'unknown'}`,
      agent.ownerName ? `所有者：${agent.ownerName}` : '',
      `技能数：${skills.length}，脚本数：${scripts.length}`,
    ].filter(Boolean).join('\n')
  }
  return JSON.stringify(result?.data ?? result, null, 2).slice(0, 3000)
}

function normalizeSpecialties(value: any): string[] {
  if (Array.isArray(value)) return value.map((s: any) => String(s).trim()).filter(Boolean)
  return String(value || '').split(/[，,|]/).map((s) => s.trim()).filter(Boolean)
}

async function createAgentCreateRequest(roomId: string, agentId: string, actorUserId: string, args: any) {
  await agentService.assertRoomAssistant(roomId, agentId)
  const name = String(args.name || args.agentName || '').trim()
  if (!name) throw new Error('agent name is required')
  const agent = await agentService.getAgent(agentId)
  const specialties = normalizeSpecialties(args.specialties)
  const result = await interactionService.create(roomId, { id: agent.id, name: agent.name, role: 'ai' }, {
    type: 'confirm',
    title: `确认创建 Agent：${name}`,
    description: [
      args.description ? `职责：${args.description}` : '',
      specialties.length ? `专长：${specialties.join('、')}` : '',
      '确认后会创建该 Agent 并加入当前项目。',
    ].filter(Boolean).join('\n'),
    priority: 'important',
    payload: {
      agentCreate: {
        name,
        roleType: args.roleType === 'assistant' ? 'assistant' : 'specialist',
        deployment: 'client',
        description: args.description,
        specialties,
        config: args.config || undefined,
        roomRole: args.roomRole === 'assistant' ? 'assistant' : 'specialist',
        autoEnabled: args.autoEnabled === true,
        priority: Number(args.priority || 0),
      },
    },
    options: [
      { value: 'confirm', label: '确认创建', style: 'primary' },
      { value: 'cancel', label: '取消', style: 'secondary' },
    ],
    responsePolicy: { allowChange: false, allowCancel: true },
    targetUserId: actorUserId,
  } as any)
  broadcast(roomId, 'interaction.created', { interaction: result.interaction })
  broadcast(roomId, 'chat.message', result.message)
  return { action: 'agent.create_request', success: true, data: result }
}

export async function executeInlineToolCalls(roomId: string, agentId: string, actorUserId: string | undefined, output: string) {
  const calls = extractInlineToolCalls(output)
  if (calls.length === 0) return null
  if (!actorUserId) throw new Error('actorUserId is required for inline tool calls')
  assertActorInRoom(roomId, actorUserId)
  const results = []
  for (const call of calls) {
    if (call.name === 'agent.my-list' || call.name === 'agent.my_list') {
      const agents = await agentService.getUserAgents(actorUserId)
      results.push({ action: 'agent.my-list', success: true, data: { agents } })
      continue
    }
    if (call.name === 'agent.list-available') {
      await agentService.assertRoomAssistant(roomId, agentId)
      const agents = await agentService.getAvailableAgentsForRoom(roomId, agentId)
      results.push({ action: call.name, success: true, data: { agents } })
      continue
    }
    if (call.name === 'members.list') {
      const members = db.prepare('SELECT u.id, u.username, u.nickname, rm.role FROM room_members rm JOIN users u ON u.id = rm.user_id WHERE rm.room_id = ? ORDER BY rm.role DESC, u.nickname, u.username').all(roomId)
      results.push({ action: call.name, success: true, data: { members } })
      continue
    }
    if (['agent.create', 'agent.create_request', 'agent.create-request'].includes(call.name)) {
      results.push(await createAgentCreateRequest(roomId, agentId, actorUserId, call.args || {}))
      continue
    }
    if (['agent.detail', 'agent.info'].includes(call.name)) {
      const target = call.args?.agent || call.args?.agentId || call.args?.id || agentId
      await assertActorCanUseAgentInRoom(roomId, target, actorUserId)
      const targetAgent = await agentService.getAgent(target)
      const skills = agentCapabilityService.listSkills(targetAgent.id)
      const scripts = agentCapabilityService.listScripts(targetAgent.id)
      results.push({ action: 'agent.detail', success: true, data: { agent: sanitizeAgentForInline(targetAgent), skills, scripts } })
      continue
    }
    results.push({ action: call.name, success: false, error: `Inline tool ${call.name} is not supported yet` })
  }
  return results.map((result) => formatToolResult(result.action, result)).join('\n\n')
}
