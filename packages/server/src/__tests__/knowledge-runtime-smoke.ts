import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-knowledge-runtime-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { agentKnowledgeService } = await import('../services/agent-knowledge.service.js')
const { knowledgeRuntimeService } = await import('../services/knowledge-runtime.service.js')

const now = Date.now()
try {
  initDatabase()
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'x', 'Owner', 'admin', 'human', now, now)
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('roomA', 'Room A', 'owner', now, now, now)
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('roomB', 'Room B', 'owner', now, now, now)
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run('roomA', 'owner', 'owner', 'human', now)
  db.prepare('INSERT INTO agents (id, owner_id, name, role_type, deployment, description, specialties, config, status, is_template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('agent', 'owner', 'Agent', 'assistant', 'client', null, '[]', '{}', 'active', 0, now, now)
  db.prepare('INSERT INTO room_agents (room_id, agent_id, added_by, added_at, room_role, auto_enabled, priority) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('roomA', 'agent', 'owner', now, 'assistant', 1, 0)
  db.prepare("INSERT INTO knowledge_entries (id, scope, owner_user_id, agent_id, room_id, title, content, tags, source_type, visibility, status, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'shared', 'active', ?, ?, ?, ?)")
    .run('kb_room_a', 'room', 'owner', null, 'roomA', '客户偏好', '星河项目客户要求回答必须引用房间知识。', JSON.stringify(['星河']), 'owner', 'owner', now, now)
  db.prepare("INSERT INTO knowledge_entries (id, scope, owner_user_id, agent_id, room_id, title, content, tags, source_type, visibility, status, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'shared', 'active', ?, ?, ?, ?)")
    .run('kb_room_b', 'room', 'owner', null, 'roomB', '隔离资料', '星河项目不应该读到这个房间B资料。', JSON.stringify(['星河']), 'owner', 'owner', now, now)
  db.prepare("INSERT INTO knowledge_entries (id, scope, owner_user_id, agent_id, room_id, title, content, tags, source_type, visibility, status, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'shared', 'active', ?, ?, ?, ?)")
    .run('kb_public', 'public', 'owner', null, null, '通用SOP', '星河项目回答可以参考通用知识。', JSON.stringify(['星河']), 'owner', 'owner', now, now)
  agentKnowledgeService.upsert('agent', 'owner', { path: 'manual.md', content: '星河项目 Agent 专属知识：先查知识库再回答。' }, 'owner')

  const found = knowledgeRuntimeService.searchForAgent({ roomId: 'roomA', agentId: 'agent', query: '星河项目', limit: 10 })
  assert.ok(found.results.some((x) => x.ref === 'room:kb_room_a'))
  assert.ok(found.results.some((x) => x.source === 'agent'))
  assert.ok(found.results.some((x) => x.ref === 'public:kb_public'))
  assert.equal(found.results.some((x) => x.ref === 'room:kb_room_b'), false)

  const roomRead = knowledgeRuntimeService.readForAgent({ roomId: 'roomA', agentId: 'agent', ref: 'room:kb_room_a' }) as any
  assert.match(roomRead.content, /房间知识/)
  const publicRead = knowledgeRuntimeService.readForAgent({ roomId: 'roomA', agentId: 'agent', ref: 'public:kb_public' }) as any
  assert.match(publicRead.content, /通用知识/)
  assert.throws(() => knowledgeRuntimeService.searchForAgent({ roomId: 'roomB', agentId: 'agent', query: '星河' }), (err: any) => err?.code === 'FORBIDDEN' && /Agent is not in this room/.test(err?.message || ''))

  const ctx = knowledgeRuntimeService.getRuntimeContext('roomA', 'agent', '星河项目')
  assert.match(ctx, /可参考知识库/)
  assert.match(ctx, /room:kb_room_a/)
  console.log('knowledge runtime smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
