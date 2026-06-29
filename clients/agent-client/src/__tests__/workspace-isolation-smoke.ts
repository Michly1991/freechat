import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, relative } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-agent-client-workspaces-'))
process.env.AGENT_CLIENT_HOME = join(temp, 'client-home')

const { agentRoot, agentRoomWorkspace } = await import('../config/workspace.js')
const { workspaceFor, clearAgentSession } = await import('../executor/claude.js')
const { workRoot } = await import('../config/store.js')

function agent(id: string, workdir?: string): any {
  return { agentId: id, connectorId: `connector-${id}`, accessToken: 'access', connectorToken: 'connector', enabled: true, maxConcurrency: 1, createdAt: Date.now(), updatedAt: Date.now(), workdir }
}

function event(agentId: string, roomId: string): any {
  return { id: `event-${agentId}-${roomId}`, runId: `run-${agentId}-${roomId}`, roomId, agentId, type: 'agent.mentioned', payload: { actorUserId: 'owner', input: 'hi' } }
}

function assertInside(parent: string, child: string) {
  const rel = relative(parent, child)
  assert.equal(Boolean(rel && !rel.startsWith('..') && !rel.includes('..')), true, `${child} should be inside ${parent}`)
}

try {
  const a1 = agent('agent-one')
  const a2 = agent('agent-two')
  const a1RoomA = workspaceFor(a1, event('agent-one', 'room-a'))
  const a1RoomB = workspaceFor(a1, event('agent-one', 'room-b'))
  const a2RoomA = workspaceFor(a2, event('agent-two', 'room-a'))

  assert.notEqual(a1RoomA, a2RoomA)
  assert.notEqual(a1RoomA, a1RoomB)
  assert.equal(a1RoomA, join(workRoot(), 'agents', 'agent-one', 'rooms', 'room-a'))
  assert.equal(a2RoomA, join(workRoot(), 'agents', 'agent-two', 'rooms', 'room-a'))
  for (const dir of [a1RoomA, a1RoomB, a2RoomA]) {
    assert.equal(existsSync(join(dir, '.freechat')), true)
    assert.equal(existsSync(join(dir, 'res', 'downloads')), true)
    assert.equal(existsSync(join(dir, 'res', 'outputs')), true)
    assert.equal(existsSync(join(dir, 'workspace')), true)
  }

  const sharedCustomRoot = join(temp, 'custom-root')
  const c1 = agent('custom-one', sharedCustomRoot)
  const c2 = agent('custom-two', sharedCustomRoot)
  const c1Room = workspaceFor(c1, event('custom-one', 'same-room'))
  const c2Room = workspaceFor(c2, event('custom-two', 'same-room'))
  assert.notEqual(c1Room, c2Room)
  assert.equal(c1Room, join(sharedCustomRoot, 'agents', 'custom-one', 'rooms', 'same-room'))
  assert.equal(c2Room, join(sharedCustomRoot, 'agents', 'custom-two', 'rooms', 'same-room'))
  assert.notEqual(agentRoot(c1), agentRoot(c2))

  const session = join(a1RoomA, '.freechat', 'claude-session.json')
  mkdirSync(dirname(session), { recursive: true })
  writeFileSync(session, '{}')
  clearAgentSession(a1, 'room-a')
  assert.equal(existsSync(session), false)

  assertInside(agentRoomWorkspace(a1, 'room-c'), join(agentRoomWorkspace(a1, 'room-c'), 'res', 'downloads', 'input.xlsx'))
  console.log('agent-client workspace isolation smoke passed')
} finally {
  rmSync(temp, { recursive: true, force: true })
}
