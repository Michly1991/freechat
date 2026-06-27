import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-entry-handoff-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { workgroupService } = await import('../services/workgroup.service.js')
const { agentService } = await import('../services/agent.service.js')
const { handleRoomHandoffTool } = await import('../routes/agent-tools-handoff.js')

const now = Date.now()
function user(id: string, role = 'user') {
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, id, 'x', id, role, 'human', now, now)
}
function agent(id: string, ownerId: string, name: string, roleType = 'assistant', config: any = { tools: { members: true } }) {
  db.prepare('INSERT INTO agents (id, owner_id, name, role_type, deployment, description, specialties, config, status, is_template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, ownerId, name, roleType, 'client', `${name} desc`, JSON.stringify([name]), JSON.stringify(config), 'active', 1, now, now)
}

try {
  initDatabase()
  user('owner')
  user('visitor')
  agent('agent_router', 'owner', '接待员')
  agent('agent_lawyer', 'owner', '法律顾问')

  const overview = workgroupService.createWorkgroup('owner', { name: '服务工作组' })
  const workgroupId = overview.workgroup.id
  workgroupService.addAgent(workgroupId, 'agent_router')
  workgroupService.addAgent(workgroupId, 'agent_lawyer')
  const entry = workgroupService.createEntry(workgroupId, 'owner', { agentId: 'agent_router', title: '咨询入口' }) as any
  const joined = await workgroupService.joinEntry(entry.token, 'visitor') as any
  const roomId = joined.room.id

  let agents = await agentService.getRoomAgents(roomId)
  assert.deepEqual(agents.map((item: any) => item.id), ['agent_router'])

  const router = await agentService.getAgent('agent_router')
  const result = await handleRoomHandoffTool(roomId, router, 'visitor', { agent: '法律顾问', reason: '用户需要法律咨询', wake: false }) as any
  assert.equal(result.success, true)

  agents = await agentService.getRoomAgents(roomId)
  const materializedLawyer = agents.find((item: any) => item.id === 'agent_lawyer' || item.sourceTemplateId === 'agent_lawyer')
  assert.ok(materializedLawyer, 'target workgroup Agent should be materialized into entry room')
  const room = await import('../services/room.service.js').then((m) => m.roomService.getRoom(roomId) as any)
  assert.equal(room.currentAssistantAgentId, materializedLawyer.id)

  console.log('entry room handoff smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
