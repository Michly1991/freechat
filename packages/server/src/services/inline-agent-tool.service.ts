import db from '../storage/db.js'
import { agentService } from './agent.service.js'

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
  return JSON.stringify(result?.data ?? result, null, 2).slice(0, 3000)
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
    results.push({ action: call.name, success: false, error: `Inline tool ${call.name} is not supported yet` })
  }
  return results.map((result) => formatToolResult(result.action, result)).join('\n\n')
}
