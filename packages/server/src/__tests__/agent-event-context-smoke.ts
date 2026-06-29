import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-agent-event-context-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { agentService } = await import('../services/agent.service.js')
const { roomFileService } = await import('../services/room-file.service.js')
const { messageService } = await import('../services/message.service.js')
const { agentEventContextService } = await import('../services/agent-event-context.service.js')
const { remoteAgentConnectorService } = await import('../services/remote-agent-connector.service.js')

const now = Date.now()
try {
  initDatabase()
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'x', 'Owner', 'user', 'human', now, now)
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('room', 'Room', 'owner', now, now, now)
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run('room', 'owner', 'owner', 'human', now)
  const agent = await agentService.createAgent('owner', { name: '专家', roleType: 'specialist', deployment: 'client', description: 'expert', specialties: [], config: {} as any })
  await agentService.addAgentToRoom('room', agent.agent.id, 'owner', { roomRole: 'specialist', autoEnabled: false })
  const folderId = roomFileService.ensureFolder('room', 'message-files/msg_file', 'message', 'owner', 'msg_file')
  const uploaded = roomFileService.upsertFileRecord({ roomId: 'room', folderId, name: '志愿表.xlsx', rel: 'message-files/msg_file/志愿表.xlsx', storagePath: 'message-files/msg_file/志愿表.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 12, source: 'message_attachment', messageId: 'msg_file', uploadedBy: 'owner' })
  await messageService.createMessage('room', 'owner', 'Owner', 'human', '[附件]', undefined, undefined, 'text', { attachments: [uploaded] }, 'msg_file')
  await messageService.createMessage('room', 'owner', 'Owner', 'human', '就刚刚发给你的表格继续分析', undefined, undefined, 'text')

  const ctx = await agentEventContextService.build({ roomId: 'room', agentId: agent.agent.id, actorUserId: 'owner', input: '继续分析刚才表格' })
  assert.match(ctx.promptText, /志愿表\.xlsx/)
  assert.match(ctx.promptText, /file:/)
  assert.equal(ctx.recentFileRefs[0]?.name, '志愿表.xlsx')

  const { eventId } = await remoteAgentConnectorService.enqueueRun('room', agent.agent.id, '继续分析刚才表格', { actorUserId: 'owner', responseMode: 'final_to_chat' })
  const event = db.prepare('SELECT payload_json FROM remote_agent_events WHERE id = ?').get(eventId) as any
  const payload = JSON.parse(event.payload_json)
  assert.match(payload.context.promptText, /志愿表\.xlsx/)
  assert.equal(payload.context.recentFileRefs[0]?.ref, uploaded.ref)

  console.log('agent event context smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
