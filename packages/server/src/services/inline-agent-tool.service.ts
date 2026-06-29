import db from '../storage/db.js'
import { messageService } from './message.service.js'
import { executeTool } from '../app-actions/router.js'
import { extractInlineToolCalls } from './inline-tool-markup.js'

type ToolCall = { name: string; args: any }

function assertActorInRoom(roomId: string, actorUserId: string) {
  const row = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, actorUserId)
  if (!row) throw new Error('Current user is not a member of this room')
}

function isXiaomiAgent(agentId: string) {
  const row = db.prepare('SELECT config FROM agents WHERE id = ?').get(agentId) as any
  return String(row?.config || '').includes('"builtInKey":"xiaomi_assistant"')
}

function summarizeAgent(agent: any) {
  const parts = [agent.name]
  if (agent.description) parts.push(`：${agent.description}`)
  if (Array.isArray(agent.specialties) && agent.specialties.length) parts.push(`（${agent.specialties.slice(0, 4).join('、')}）`)
  return parts.join('')
}

function formatToolResult(action: string, result: any) {
  if (!result?.success) {
    const err = result?.error
    const message = typeof err === 'string' ? err : err?.message || JSON.stringify(err || {})
    return `工具 ${action} 执行失败：${message}`
  }
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
  if (action === 'file.read') {
    const data = result?.data || result
    const file = data?.file
    const header = file ? `文件：${file.name || file.path}（${file.ref || file.id || file.path}）` : '文件内容：'
    const body = String(data?.content || '')
    const tail = data?.truncated ? `\n\n[内容已截断，offset=${data.offset}，limit=${data.limit}，totalChars=${data.totalChars}]` : ''
    return `${header}\n${body}${tail}`.slice(0, 12000)
  }
  if (action === 'file.list') {
    const files = result?.data?.fileRefs || result?.data?.files || result?.files || []
    if (!files.length) return '当前房间没有文件。'
    return `当前房间文件（包含聊天附件）：\n${files.slice(0, 30).map((file: any, i: number) => `${i + 1}. ${file.name || file.path || file.relativePath || file.relative_path} (${file.ref || (file.id ? `file:${file.id}` : file.path || file.relativePath || file.relative_path)})${file.source === 'message_attachment' ? ' [聊天附件]' : ''}`).join('\n')}`
  }
  if (action === 'file.info') {
    const file = result?.data?.file || result?.file
    if (!file) return '没有查到该文件。'
    return [`文件：${file.name || file.path}`, `引用：${file.ref || file.id || file.path}`, `路径：${file.path || ''}`, `类型：${file.mimeType || 'unknown'}`, `大小：${file.size || 0} bytes`, result?.data?.hint || ''].filter(Boolean).join('\n')
  }
  if (['pdf.read', 'excel.read', 'word.read', 'ppt.read'].includes(action)) {
    const data = result?.data || result
    const file = data?.file
    const body = data?.csv || data?.text || JSON.stringify(data?.rows || data?.slides || data, null, 2)
    const header = file ? `文件：${file.name || file.path}（${file.ref || file.path}）` : `工具结果：${action}`
    const tail = data?.truncated ? `\n\n[内容已截断，totalChars=${data.totalChars}]` : ''
    return `${header}\n${String(body || '')}${tail}`.slice(0, 12000)
  }
  if (['excel.write', 'word.write', 'ppt.write'].includes(action)) {
    const file = result?.data?.file || result?.file
    return file ? `已生成文件：${file.name || file.relativePath || file.path}（${file.ref || file.id}）` : '文件已生成。'
  }
  if (action === 'image.read') {
    const data = result?.data || result
    const file = data?.file
    return [`图片：${file?.name || file?.path || ''}`, data?.text || ''].filter(Boolean).join('\n').slice(0, 12000)
  }
  if (action === 'mindmap.create') {
    const preview = result?.data?.preview || result?.preview
    return preview ? `已生成脑图预览：${preview.title}（previewId: ${preview.id}）。聊天窗口会直接展示；如用户确认保存，再调用 mindmap.save。` : '已生成脑图预览。'
  }
  if (action === 'mindmap.save') {
    const saved = result?.data?.saved || result?.saved
    return saved ? `已保存脑图：${saved.title}（目录：${saved.directory}）` : '脑图已保存。'
  }
  if (action === 'tab.list') {
    const tabs = result?.data?.tabs || result?.tabs || []
    if (!tabs.length) return '当前房间还没有页面 Tab。'
    return `当前页面 Tab：\n${tabs.map((tab: any, i: number) => `${i + 1}. ${tab.title || tab.name || tab.id}（${tab.id}）`).join('\n')}`
  }
  if (action === 'tab.get' || action === 'tab.read') {
    const tab = result?.data?.tab || result?.tab
    if (!tab) return '没有查到该页面 Tab。'
    return [`页面：${tab.title || tab.name || tab.id}`, `ID：${tab.id}`, String(tab.content || '').slice(0, 12000)].filter(Boolean).join('\n')
  }
  if (['tab.create', 'tab.create-from-file', 'tab.update', 'tab.patch', 'tab.set-default'].includes(action)) {
    const tab = result?.data?.tab || result?.tab
    return tab ? `页面已更新：${tab.title || tab.name || tab.id}（${tab.id}）` : '页面操作已完成。'
  }
  if (['tab.delete', 'tab.reorder', 'tab.open', 'tab.action'].includes(action)) return '页面操作已完成。'
  if (action === 'members.list') {
    const members = result?.data?.members || result?.members || []
    if (!members.length) return '当前房间没有成员。'
    return `当前房间成员：\n${members.map((m: any, i: number) => `${i + 1}. ${m.nickname || m.username || m.name || m.id}（${m.role || m.roomRole || m.type || '-'}）`).join('\n')}`
  }
  if (action === 'tool.list') {
    const tools = result?.data?.tools || result?.tools || []
    return `可用工具：${tools.map((tool: any) => tool.action || tool.name).filter(Boolean).slice(0, 80).join('、')}`
  }
  if (action === 'tool.schema' || action === 'tool.help') {
    const tool = result?.data?.tool || result?.data || result
    return JSON.stringify(tool, null, 2).slice(0, 6000)
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
    const scopeRoomId = call.args?.roomId || call.args?.scopeRoomId || undefined
    if (scopeRoomId) {
      if (!isXiaomiAgent(agentId)) throw new Error('Only XiaoMi can operate across rooms as the current user')
      assertActorInRoom(String(scopeRoomId), actorUserId)
    }
    const action = call.name === 'agent.create_request' ? 'agent.create-request' : call.name === 'agent.my_list' ? 'agent.my-list' : call.name
    try {
      const actor = db.prepare('SELECT role FROM users WHERE id = ?').get(actorUserId) as any
      const response = await executeTool({ roomId: String(scopeRoomId || roomId), action, args: call.args || {}, agentId, actorUserId, actorRole: actor?.role, transport: 'platform-inline', recordMindmapPreview: true }, { messageService })
      results.push({ action, success: response?.success !== false, data: response?.data, error: response?.error })
    } catch (err: any) {
      results.push({ action, success: false, error: { code: err?.code || 'INLINE_TOOL_ERROR', message: err?.message || String(err) } })
    }
  }
  return results.map((result) => formatToolResult(result.action, result)).join('\n\n')
}
