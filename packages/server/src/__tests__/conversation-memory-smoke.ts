import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-memory-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { conversationMemoryService } = await import('../services/conversation-memory.service.js')
const { agentService } = await import('../services/agent.service.js')

const now = Date.now()
try {
  initDatabase()
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'x', 'Owner', 'user', 'human', now, now)
  db.prepare('INSERT INTO rooms (id, name, description, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('room', '记忆房间', '测试长期记忆', 'owner', now, now, now)
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run('room', 'owner', 'owner', 'human', now)
  db.prepare('INSERT INTO agents (id, owner_id, name, role_type, deployment, description, specialties, config, status, is_template, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('agent', 'owner', '小蜜', 'assistant', 'server', '协调者', '[]', '{"roomId":"room"}', 'active', 0, now, now)
  db.prepare('INSERT INTO room_agents (room_id, agent_id, added_by, added_at, room_role, auto_enabled, priority) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('room', 'agent', 'owner', now, 'assistant', 1, 0)
  db.prepare('INSERT INTO messages (id, room_id, actor_id, actor_name, actor_role, content, mentions, created_at, kind, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .run('m1', 'room', 'owner', 'Owner', 'human', '确认：这个房间的项目目标是长期维护 FreeChat 记忆机制，必须只保存未来有用的信息。', '[]', now + 1, 'text')
  db.prepare('INSERT INTO messages (id, room_id, actor_id, actor_name, actor_role, content, mentions, created_at, kind, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .run('m2', 'room', 'agent', '小蜜', 'ai', '我会记住：达到阈值后压缩，寒暄不进入长期记忆。', '[]', now + 2, 'text')

  await conversationMemoryService.compact('room', 'room', null)
  await conversationMemoryService.compact('agent', 'room', 'agent')

  const roomMemoryPath = join(process.env.WORKSPACE_ROOT!, 'rooms', 'room', 'memory', 'ROOM_MEMORY.md')
  const agentMemoryPath = join(process.env.WORKSPACE_ROOT!, 'rooms', 'room', 'memory', 'agents', 'agent.md')
  assert.equal(existsSync(roomMemoryPath), true)
  assert.equal(existsSync(agentMemoryPath), true)
  assert.match(readFileSync(roomMemoryPath, 'utf8'), /FreeChat|记忆|目标|确认/)

  await agentService.prepareAgentWorkspace('room', {
    id: 'agent',
    name: '小蜜',
    roleType: 'assistant',
    ownerId: 'owner',
    description: '协调者',
    specialties: [],
    config: { roomId: 'room' } as any,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  } as any, 'owner')
  assert.equal(existsSync(join(process.env.WORKSPACE_ROOT!, 'rooms', 'room', 'agents', 'agent', '.freechat', 'MEMORY.md')), true)
  assert.equal(existsSync(join(process.env.WORKSPACE_ROOT!, 'rooms', 'room', 'agents', 'agent', '.freechat', 'AGENT_MEMORY.md')), true)
  console.log('conversation memory smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
