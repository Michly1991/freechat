#!/usr/bin/env node
import { createRequire } from 'node:module'

const require = createRequire(new URL('../packages/server/package.json', import.meta.url))
const Database = require('better-sqlite3')

const base = process.env.FREECHAT_BASE_URL || 'http://localhost:3001/api'
const username = `smoke_${Date.now()}`
const password = 'SmokeTest123!'
const db = new Database('.freechat/data/freechat.db')

async function req(path, opts = {}) {
  const hasBody = opts.body !== undefined
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers || {}) },
    body: hasBody && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  return { status: res.status, ok: res.ok, json }
}
function assert(cond, message, details) { if (!cond) throw Object.assign(new Error(message), { details }) }
async function main() {
  const steps = []
  const health = await fetch(`${base}/health`).then((r) => r.json())
  steps.push({ step: 'health', ok: health.status === 'ok' })

  const reg = await req('/auth/register', { method: 'POST', body: { username, password, nickname: 'Smoke Test' } })
  assert(reg.ok, 'register failed', reg)
  const token = reg.json.data.token
  const userId = reg.json.data.user.id
  steps.push({ step: 'register', ok: true, username, userId })

  const me = await req('/auth/me', { token })
  assert(me.ok && me.json.data.username === username, 'me failed', me)
  steps.push({ step: 'auth/me', ok: true })

  const blocked = await req('/rooms', { method: 'POST', token, body: { name: 'Smoke blocked room', agents: [], memberIds: [] } })
  assert(blocked.status === 402 && blocked.json.error?.code === 'INSUFFICIENT_CREDITS', 'zero-balance room gate failed', blocked)
  steps.push({ step: 'zero balance create-room gate', ok: true })

  db.prepare('INSERT OR IGNORE INTO credit_accounts (user_id,balance,income_balance,updated_at) VALUES (?,0,0,?)').run(userId, Date.now())
  db.prepare('UPDATE credit_accounts SET balance=?, updated_at=? WHERE user_id=?').run(10000, Date.now(), userId)
  db.prepare(`INSERT INTO credit_transactions (id,user_id,type,amount,balance_after,note,created_at) VALUES (?,?,?,?,?,?,?)`).run(`ctx_smoke_${Date.now()}`, userId, 'admin_adjust', 10000, 10000, 'smoke test recharge 1 credit', Date.now())
  steps.push({ step: 'recharge temp user', ok: true, credits: 1 })

  const agentCreate = await req('/agents', { method: 'POST', token, body: { name: `Smoke Agent ${Date.now()}`, roleType: 'specialist', deployment: 'server', description: 'smoke delete test', specialties: ['smoke'], config: { tools: {}, systemPrompt: 'Smoke test agent' } } })
  assert(agentCreate.status === 201 && agentCreate.json.data.agent.id, 'create agent failed', agentCreate)
  const agentId = agentCreate.json.data.agent.id
  steps.push({ step: 'create agent', ok: true, agentId })

  const agentDelete = await req(`/agents/${agentId}`, { method: 'DELETE', token })
  assert(agentDelete.ok, 'delete agent failed', agentDelete)
  const afterAgentDelete = await req('/agents', { token })
  assert(afterAgentDelete.ok && !afterAgentDelete.json.data.agents.some((agent) => agent.id === agentId), 'deleted agent still listed', afterAgentDelete)
  steps.push({ step: 'delete agent', ok: true })

  for (const [name, path] of [['agents','/agents'], ['scenes','/scenes'], ['modelProfiles','/model-profiles'], ['billingSummary','/billing/summary?role=payer'], ['billingLedger','/billing/ledger?role=payer&limit=5']]) {
    const r = await req(path, { token })
    assert(r.ok, `${name} failed`, r)
    steps.push({ step: name, ok: true })
  }

  const created = await req('/rooms', { method: 'POST', token, body: { name: 'Smoke Test Room', description: 'auto smoke', agents: [], memberIds: [] } })
  assert(created.ok && created.json.data.room.id, 'create room failed', created)
  const roomId = created.json.data.room.id
  steps.push({ step: 'create room', ok: true, roomId })

  const room = await req(`/rooms/${roomId}`, { token })
  assert(room.ok, 'get room failed', room)
  steps.push({ step: 'get room', ok: true })

  const roomAgentTemplate = await req('/agents', { method: 'POST', token, body: { name: `Smoke Room Agent ${Date.now()}`, roleType: 'specialist', deployment: 'server', description: 'smoke room remove test', specialties: ['smoke'], config: { tools: {}, systemPrompt: 'Smoke test room agent' } } })
  assert(roomAgentTemplate.status === 201 && roomAgentTemplate.json.data.agent.id, 'create room-agent template failed', roomAgentTemplate)
  const roomAgentTemplateId = roomAgentTemplate.json.data.agent.id
  const addRoomAgent = await req(`/rooms/${roomId}/agents`, { method: 'POST', token, body: { agentId: roomAgentTemplateId, roomRole: 'specialist', autoEnabled: false } })
  assert(addRoomAgent.ok, 'add room agent failed', addRoomAgent)
  const roomAgentsBeforeRemove = await req(`/rooms/${roomId}/agents`, { token })
  const roomAgent = roomAgentsBeforeRemove.json.data.agents.find((agent) => agent.id === roomAgentTemplateId || agent.sourceTemplateId === roomAgentTemplateId)
  assert(roomAgentsBeforeRemove.ok && roomAgent, 'room agent not listed after add', roomAgentsBeforeRemove)
  const removeRoomAgent = await req(`/rooms/${roomId}/agents/${roomAgent.id}`, { method: 'DELETE', token })
  assert(removeRoomAgent.ok, 'remove room agent failed', removeRoomAgent)
  const roomAgentsAfterRemove = await req(`/rooms/${roomId}/agents`, { token })
  assert(roomAgentsAfterRemove.ok && !roomAgentsAfterRemove.json.data.agents.some((agent) => agent.id === roomAgent.id || agent.sourceTemplateId === roomAgentTemplateId), 'room agent still listed after remove', roomAgentsAfterRemove)
  steps.push({ step: 'room agent add/remove', ok: true })
  await req(`/agents/${roomAgentTemplateId}`, { method: 'DELETE', token })

  const roomAgents = await req(`/rooms/${roomId}/agents`, { token })
  assert(roomAgents.ok, 'room agents failed', roomAgents)
  steps.push({ step: 'room agents', ok: true })

  const del = await req(`/rooms/${roomId}`, { method: 'DELETE', token })
  assert(del.ok, 'delete room failed', del)
  const roomsAfterDelete = await req('/rooms', { token })
  assert(roomsAfterDelete.ok && !roomsAfterDelete.json.data.rooms.some((room) => room.id === roomId), 'deleted room still visible in room list', roomsAfterDelete)
  steps.push({ step: 'delete room soft-hide', ok: true })

  console.log(JSON.stringify({ ok: true, steps }, null, 2))
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message, details: err.details }, null, 2))
  process.exit(1)
}).finally(() => db.close())
