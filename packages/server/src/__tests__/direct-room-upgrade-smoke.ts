import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import assert from 'assert'

const temp = mkdtempSync(join(tmpdir(), 'freechat-direct-upgrade-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.JWT_SECRET = 'test-secret'
process.env.LOG_LEVEL = 'silent'

const { default: db } = await import('../storage/db.js')
const { roomService } = await import('../services/room.service.js')
const { agentService } = await import('../services/agent.service.js')
const { buildApp } = await import('../app.js')
const { generateToken } = await import('../auth/jwt.js')

const app = await buildApp()

function user(id: string, name = id) {
  const now = Date.now()
  db.prepare('INSERT OR REPLACE INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, id, 'x', name, 'user', 'human', now, now)
}

function auth(id: string) {
  return { authorization: `Bearer ${generateToken({ id, username: id, nickname: id, role: 'user', identityType: 'human' } as any)}` }
}

try {
  user('owner', 'Owner')
  user('friend', 'Friend')
  user('newbie', 'Newbie')

  const direct = await roomService.createRoom('Friend', 'direct', 'owner', ['friend'], [], {
    skipDefaultAssistant: true,
    roomKind: 'direct_user',
    directKey: 'user:friend:owner',
    directTargetType: 'user',
    directTargetId: 'friend',
    syncInitialMembersToWorkgroup: false,
  }) as any

  const res = await app.inject({ method: 'POST', url: `/api/rooms/${direct.id}/members`, headers: auth('owner'), payload: { userId: 'newbie', role: 'editor' } })
  assert.equal(res.statusCode, 200, res.body)
  const body = res.json()
  assert.equal(body.data.createdRoom, true)
  assert.notEqual(body.data.room.id, direct.id)
  assert.equal(body.data.room.roomKind, 'group')
  assert.equal(body.data.room.sourceRoomId, direct.id)
  assert.deepEqual((await roomService.getRoomMembers(direct.id)).map((m: any) => m.userId).sort(), ['friend', 'owner'])
  assert.deepEqual((await roomService.getRoomMembers(body.data.room.id)).map((m: any) => m.userId).sort(), ['friend', 'newbie', 'owner'])

  const agent = await agentService.createAgent('owner', { name: '猫猫', roleType: 'specialist', deployment: 'client', description: 'test', specialties: [], config: {} as any })
  const agentRes = await app.inject({ method: 'POST', url: `/api/rooms/${direct.id}/agents`, headers: auth('owner'), payload: { agentId: agent.agent.id, roomRole: 'specialist' } })
  assert.equal(agentRes.statusCode, 200, agentRes.body)
  const agentBody = agentRes.json()
  assert.equal(agentBody.data.createdRoom, true)
  assert.notEqual(agentBody.data.room.id, direct.id)
  assert.equal(agentBody.data.room.sourceRoomId, direct.id)
  assert.equal((await agentService.getRoomAgents(direct.id)).length, 0)
  assert.equal((await agentService.getRoomAgents(agentBody.data.room.id)).length, 1)

  console.log('direct room upgrade smoke passed')
} finally {
  await app.close()
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
