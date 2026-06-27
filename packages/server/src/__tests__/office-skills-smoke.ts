import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-office-skills-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { agentService } = await import('../services/agent.service.js')
const { roomFileService } = await import('../services/room-file.service.js')
const { executeInlineToolCalls } = await import('../services/inline-agent-tool.service.js')
const { executeAppAction } = await import('../app-actions/executor.js')

const now = Date.now()
try {
  initDatabase()
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'x', 'Owner', 'user', 'human', now, now)
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('room', 'Room', 'owner', now, now, now)
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run('room', 'owner', 'owner', 'human', now)
  const created = await agentService.createAgent('owner', { name: '小蜜', roleType: 'assistant', deployment: 'server', description: 'assistant', specialties: [], config: { builtInKey: 'xiaomi_assistant' } as any })
  await agentService.addAgentToRoom('room', created.agent.id, 'owner', { roomRole: 'assistant', autoEnabled: true })
  const ctx = { roomId: 'room', agentId: created.agent.id, actorUserId: 'owner' }

  const excelWrite = await executeAppAction(ctx, 'excel.write', { targetPath: 'outputs/demo.xlsx', rows: [['名称', '金额'], ['合同', 12345]] })
  assert.equal(excelWrite.response?.success, true)
  const excelRef = excelWrite.response.data.file.ref
  const excelRead = await executeAppAction(ctx, 'excel.read', { ref: excelRef, range: 'A1:B2' })
  assert.match(excelRead.response?.data.csv, /合同,12345/)

  const wordWrite = await executeAppAction(ctx, 'word.write', { targetPath: 'outputs/demo.docx', content: '第一段\n\n合同金额 12345' })
  const wordRead = await executeAppAction(ctx, 'word.read', { ref: wordWrite.response.data.file.ref })
  assert.match(wordRead.response?.data.text, /合同金额 12345/)

  const pptWrite = await executeAppAction(ctx, 'ppt.write', { targetPath: 'outputs/demo.pptx', slides: [{ title: '标题', text: 'PPT 内容' }] })
  const pptRead = await executeAppAction(ctx, 'ppt.read', { ref: pptWrite.response.data.file.ref })
  assert.match(pptRead.response?.data.text, /PPT 内容/)

  const inline = await executeInlineToolCalls('room', created.agent.id, 'owner', `<toolcall>{"name":"excel.read","args":{"ref":"${excelRef}","range":"A1:B2"}}</toolcall>`)
  assert.match(inline || '', /合同,12345/)

  console.log('office skills smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
