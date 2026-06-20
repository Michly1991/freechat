#!/usr/bin/env node
const url = process.env.AGENT_CLIENT_URL || 'http://127.0.0.1:5188'
const password = process.env.AGENT_CLIENT_ADMIN_PASSWORD || '1234'
async function call(path, init = {}, token) {
  const res = await fetch(`${url}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(token ? { 'x-agent-client-session': token } : {}), ...(init.headers || {}) } })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}
async function main() {
  const login = await call('/api/local/login', { method: 'POST', body: JSON.stringify({ password }) })
  if (!login.res.ok || login.data.success === false) throw new Error('local login failed')
  const token = login.data.data.sessionToken
  const state = await call('/api/local/state', {}, token)
  const originalServerUrl = state.data?.data?.config?.serverUrl || state.data?.config?.serverUrl || 'http://127.0.0.1:3001'
  const config = await call('/api/local/config', { method: 'PATCH', body: JSON.stringify({ serverUrl: originalServerUrl }) }, token)
  if (!config.res.ok || config.data.success === false) throw new Error('config patch failed')
  const test = await call('/api/local/server/test', { method: 'POST', body: JSON.stringify({ serverUrl: originalServerUrl }) }, token)
  if (!test.res.ok || test.data.success === false) throw new Error('server test failed')
  const agentsGet = await call('/api/local/server/agents', {}, token)
  if (![200, 500].includes(agentsGet.res.status)) throw new Error(`expected agents GET to return 200 when logged in or 500 when unauthenticated, got ${agentsGet.res.status}`)
  const agentsPost = await call('/api/local/server/agents', { method: 'POST', body: JSON.stringify({}) }, token)
  if (![400, 500].includes(agentsPost.res.status)) throw new Error(`expected invalid/unauthenticated agents POST to fail, got ${agentsPost.res.status}`)
  if (JSON.stringify(agentsPost.data).includes('agents')) throw new Error('POST /server/agents appears to be routed to list endpoint')
  console.log(JSON.stringify({ ok: true, checked: ['config', 'server/test', 'server/agents GET', 'server/agents POST route'] }, null, 2))
}
main().catch((err) => { console.error(err.message || err); process.exit(1) })
