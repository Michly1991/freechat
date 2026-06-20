#!/usr/bin/env node
const url = process.env.AGENT_CLIENT_URL || 'http://127.0.0.1:5188'
const password = process.env.AGENT_CLIENT_ADMIN_PASSWORD || '1234'
async function main() {
  const page = await fetch(url)
  if (!page.ok) throw new Error(`console not reachable: ${page.status}`)
  const login = await fetch(`${url}/api/local/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  const data = await login.json()
  if (!login.ok || data.success === false) throw new Error(data.error?.message || `login failed: ${login.status}`)
  const token = data.data?.sessionToken
  const state = await fetch(`${url}/api/local/state`, { headers: { 'x-agent-client-session': token } })
  const stateJson = await state.json()
  if (!state.ok || stateJson.success === false) throw new Error(stateJson.error?.message || `state failed: ${state.status}`)
  const health = await fetch(`${url}/api/local/health`, { headers: { 'x-agent-client-session': token } })
  const healthJson = await health.json()
  if (!health.ok || healthJson.success === false) throw new Error(healthJson.error?.message || `health failed: ${health.status}`)
  console.log(JSON.stringify({ ok: true, state: stateJson.data.runtime, health: healthJson.data }, null, 2))
}
main().catch((err) => { console.error(err.message || err); process.exit(1) })
