import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-app-actions-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { agentService } = await import('../services/agent.service.js')
const { agentKnowledgeService } = await import('../services/agent-knowledge.service.js')
const { executeAppAction } = await import('../app-actions/executor.js')
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
  const created = await agentService.createAgent('owner', { name: '小蜜', roleType: 'assistant', deployment: 'server', description: 'assistant', specialties: ['管理'], config: { builtInKey: 'xiaomi_assistant' } as any })
  await agentService.addAgentToRoom('room', created.agent.id, 'owner', { roomRole: 'assistant', autoEnabled: true })
  agentKnowledgeService.upsert(created.agent.id, 'owner', { name: '说明.md', path: '说明.md', content: '小蜜可以代替界面查询账单和管理知识库。' }, 'owner')

  const ctx = { roomId: 'room', agentId: created.agent.id, actorUserId: 'owner' }
  const tools = await executeAppAction(ctx, 'tool.schema', { action: 'billing.summary' })
  assert.equal(tools.handled, true)
  assert.equal(tools.response?.data?.tool?.action, 'billing.summary')

  const billing = await executeAppAction(ctx, 'app.call', { action: 'billing.summary', args: { range: 'this_month' } })
  assert.equal(billing.handled, true)
  assert.equal(billing.response?.success, true)
  assert.ok(billing.response?.data?.account)

  const knowledge = await executeAppAction(ctx, 'app.call', { action: 'agent.knowledge.search', args: { agent: '小蜜', query: '账单' } })
  assert.equal(knowledge.handled, true)
  assert.ok(knowledge.response?.data?.results?.length >= 1)

  const inline = await executeInlineToolCalls('room', created.agent.id, 'owner', '<toolcall>{"name":"app.call","args":{"action":"agent.knowledge.search","args":{"agent":"小蜜","query":"知识库"}}}</toolcall>')
  assert.match(inline || '', /知识库|results|agent/)
  console.log('app actions smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
