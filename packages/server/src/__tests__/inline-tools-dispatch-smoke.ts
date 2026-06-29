import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-inline-tools-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'
process.env.DISABLE_CONVERSATION_MEMORY_HOOKS = '1'

const { default: db, initDatabase } = await import('../storage/db.js')
const { agentService } = await import('../services/agent.service.js')
const { executeInlineToolCalls } = await import('../services/inline-agent-tool.service.js')

const now = Date.now()
try {
  initDatabase()
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'x', 'Owner', 'user', 'human', now, now)
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('room', 'Room', 'owner', now, now, now)
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run('room', 'owner', 'owner', 'human', now)
  db.prepare('INSERT INTO tabs (id, room_id, title, content, icon, sort_order, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('tab_demo', 'room', '项目看板', '<h1>项目看板</h1>', 'file', 0, 'owner', now, now)

  const created = await agentService.createAgent('owner', { name: '小蜜', roleType: 'assistant', deployment: 'server', description: 'assistant', specialties: [], config: { builtInKey: 'xiaomi_assistant' } as any })
  await agentService.addAgentToRoom('room', created.agent.id, 'owner', { roomRole: 'assistant', autoEnabled: true })

  const list = await executeInlineToolCalls('room', created.agent.id, 'owner', '<toolcall>{"name":"tab.list","args":{}}</toolcall>')
  assert.match(list || '', /当前页面 Tab/)
  assert.match(list || '', /项目看板/)
  assert.doesNotMatch(list || '', /not supported|success.*false/i)

  const update = await executeInlineToolCalls('room', created.agent.id, 'owner', '<toolcall>{"name":"tab.update","args":{"tabId":"tab_demo","content":"<h1>更新后</h1>"}}</toolcall>')
  assert.match(update || '', /页面已更新/)
  const row = db.prepare('SELECT content FROM tabs WHERE id = ?').get('tab_demo') as any
  assert.equal(row.content, '<h1>更新后</h1>')

  const { roomFileService } = await import('../services/room-file.service.js')
  const { messageService, renderMessageForAgentContext } = await import('../services/message.service.js')
  const uploaded = roomFileService.upsertFileRecord({ roomId: 'room', folderId: roomFileService.ensureFolder('room', 'message-files/msg_file', 'message', 'owner', 'msg_file'), name: '志愿表.xlsx', rel: 'message-files/msg_file/志愿表.xlsx', storagePath: 'message-files/msg_file/志愿表.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 12, source: 'message_attachment', messageId: 'msg_file', uploadedBy: 'owner' })
  const attachmentMsg = await messageService.createMessage('room', 'owner', 'Owner', 'human', '[附件]', undefined, undefined, 'text', { attachments: [uploaded] }, 'msg_file')
  assert.match(renderMessageForAgentContext(attachmentMsg), /file:/)
  assert.match(renderMessageForAgentContext(attachmentMsg), /志愿表\.xlsx/)

  const fileList = await executeInlineToolCalls('room', created.agent.id, 'owner', '<toolcall>{"name":"file.list","args":{}}</toolcall>')
  assert.match(fileList || '', /志愿表\.xlsx/)
  assert.match(fileList || '', /聊天附件/)
  const toolCalls = db.prepare('SELECT tool_name, status FROM agent_tool_calls WHERE room_id = ? ORDER BY started_at ASC').all('room') as any[]
  assert.ok(toolCalls.some((call) => call.tool_name === 'tab.list' && call.status === 'succeeded'))
  assert.ok(toolCalls.some((call) => call.tool_name === 'file.list' && call.status === 'succeeded'))

  const blocked = await executeInlineToolCalls('room', created.agent.id, 'owner', '<toolcall>{"name":"room.delete","args":{}}</toolcall>')
  assert.match(blocked || '', /Dangerous tool requires explicit confirmation|TOOL_REQUIRES_CONFIRMATION/)

  const bad = await executeInlineToolCalls('room', created.agent.id, 'owner', '<toolcall>{"name":"missing.tool","args":{}}</toolcall>')
  assert.match(bad || '', /工具 missing.tool 执行失败/)
  assert.doesNotMatch(bad || '', /^\s*\{[\s\S]*"success"\s*:\s*false/i)

  console.log('inline tools dispatch smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
