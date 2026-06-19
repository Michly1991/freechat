import { spawn } from 'child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { homedir, hostname } from 'os'
import { dirname, join } from 'path'

type Credentials = {
  serverUrl: string
  agentId: string
  connectorId: string
  accessToken: string
  connectorToken: string
  createdAt: number
  updatedAt: number
}

type RemoteEvent = {
  id: string
  runId: string
  roomId: string
  agentId: string
  type: string
  payload: { input: string; taskId?: string; subtaskId?: string; runSource?: string }
}

const VERSION = '0.1.0'
const home = process.env.FREECHAT_REMOTE_AGENT_HOME || join(homedir(), '.freechat', 'remote-claude-agent')
const credPath = join(home, 'credentials.json')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function usage() {
  console.log(`FreeChat Remote Claude Agent\n\nCommands:\n  pair --server <url> --code <pairing-code>\n  connect\n  status\n  logout\n\nEnvironment:\n  FREECHAT_REMOTE_AGENT_HOME  optional local state directory\n  FREECHAT_POLL_INTERVAL_MS   default 3000\n  FREECHAT_CLAUDE_MODEL       optional --model value\n`)
}

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name)
  return idx >= 0 ? process.argv[idx + 1] : undefined
}

function normalizeServer(url: string): string {
  return url.replace(/\/+$/, '')
}

function ensureHome() {
  mkdirSync(home, { recursive: true })
}

function saveCredentials(creds: Credentials) {
  ensureHome()
  const tmp = `${credPath}.tmp`
  writeFileSync(tmp, JSON.stringify(creds, null, 2))
  try { chmodSync(tmp, 0o600) } catch {}
  renameSync(tmp, credPath)
}

function loadCredentials(): Credentials {
  if (!existsSync(credPath)) throw new Error(`Not paired. Run: remote-claude-agent pair --server <url> --code <code>`)
  return JSON.parse(readFileSync(credPath, 'utf8'))
}

async function request<T>(serverUrl: string, path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${serverUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok || data?.success === false) {
    const message = data?.error?.message || data?.message || `HTTP ${res.status}`
    throw new Error(message)
  }
  return data.data ?? data
}

async function pair() {
  const server = arg('--server') || process.env.FREECHAT_BASE_URL
  const code = arg('--code') || process.env.FREECHAT_PAIRING_CODE
  if (!server || !code) throw new Error('pair requires --server and --code')
  const serverUrl = normalizeServer(server)
  const data = await request<any>(serverUrl, '/api/remote-agents/register', {
    method: 'POST',
    body: JSON.stringify({
      pairingCode: code,
      instanceId: process.env.FREECHAT_INSTANCE_ID || hostname(),
      name: process.env.FREECHAT_INSTANCE_NAME || hostname(),
      clientVersion: VERSION,
      capabilities: { runtime: 'claude-code', localClaudeCode: true, poll: true },
    }),
  })
  saveCredentials({
    serverUrl,
    agentId: data.agentId,
    connectorId: data.connectorId,
    accessToken: data.accessToken,
    connectorToken: data.connectorToken,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  console.log(`Paired with FreeChat Agent ${data.agentId}`)
  console.log(`Credentials saved to ${credPath}`)
}

async function heartbeat(creds: Credentials) {
  await request(creds.serverUrl, '/api/remote-agents/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ capabilities: { runtime: 'claude-code', localClaudeCode: true, version: VERSION } }),
  }, creds.accessToken)
}

async function pollEvents(creds: Credentials): Promise<RemoteEvent[]> {
  const data = await request<{ events: RemoteEvent[] }>(creds.serverUrl, '/api/remote-agents/events?limit=5', {}, creds.accessToken)
  return data.events || []
}

async function agentTool(creds: Credentials, roomId: string, action: string, args: any) {
  return request(creds.serverUrl, `/api/agent-tools/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    body: JSON.stringify({ action, args }),
  }, creds.accessToken)
}

async function complete(creds: Credentials, runId: string, payload: any) {
  return request(creds.serverUrl, `/api/remote-agents/runs/${encodeURIComponent(runId)}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  }, creds.accessToken)
}

async function fail(creds: Credentials, runId: string, error: any) {
  return request(creds.serverUrl, `/api/remote-agents/runs/${encodeURIComponent(runId)}/fail`, {
    method: 'POST',
    body: JSON.stringify({ error: error?.message || String(error) }),
  }, creds.accessToken)
}

async function activity(creds: Credentials, runId: string, text: string) {
  return request(creds.serverUrl, `/api/remote-agents/runs/${encodeURIComponent(runId)}/activity`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  }, creds.accessToken)
}

function workspaceFor(event: RemoteEvent): string {
  const dir = join(home, 'workspaces', event.roomId, event.agentId)
  mkdirSync(join(dir, '.freechat'), { recursive: true })
  const cli = join(dir, 'freechat')
  writeFileSync(cli, renderFreechatCli(), 'utf8')
  try { chmodSync(cli, 0o755) } catch {}
  writeFileSync(join(dir, '.freechat', 'run.json'), JSON.stringify({ serverUrl: loadCredentials().serverUrl, token: loadCredentials().accessToken, roomId: event.roomId }, null, 2))
  writeFileSync(join(dir, 'CLAUDE.md'), `# FreeChat Remote Agent\n\n你运行在远程服务器本机 Claude Code 环境中。\n\n- 使用 ./freechat chat send <内容> 回复房间。\n- 使用 ./freechat tool <action> '<jsonArgs>' 调用 FreeChat 工具。\n- 项目交付文件必须通过 FreeChat 工具写回，不能只留在本地。\n`, 'utf8')
  return dir
}

function renderFreechatCli(): string {
  return `#!/usr/bin/env node
import { readFileSync } from 'fs'
import { join } from 'path'
const cfg = JSON.parse(readFileSync(join(process.cwd(), '.freechat', 'run.json'), 'utf8'))
async function post(action, args) {
  const res = await fetch(cfg.serverUrl + '/api/agent-tools/' + encodeURIComponent(cfg.roomId), {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.token },
    body: JSON.stringify({ action, args })
  })
  const text = await res.text(); if (!res.ok) throw new Error(text); console.log(text)
}
const [cmd, sub, ...rest] = process.argv.slice(2)
if (cmd === 'chat' && sub === 'send') await post('chat.send', { content: rest.join(' ') })
else if (cmd === 'tool') await post(sub, JSON.parse(rest.join(' ') || '{}'))
else if (cmd === 'task' && sub === 'list') await post('task.list', { status: rest[0] })
else if (cmd === 'members' && sub === 'list') await post('members.list', {})
else if (cmd === 'room' && sub === 'info') await post('room.info', {})
else { console.error('Usage: ./freechat chat send <text> | ./freechat tool <action> <json>'); process.exit(2) }
`
}

async function runClaude(prompt: string, cwd: string): Promise<string> {
  const args = ['-p', prompt, '--permission-mode', 'auto', '--allowedTools', 'Bash(./freechat *)']
  if (process.env.FREECHAT_CLAUDE_MODEL) args.push('--model', process.env.FREECHAT_CLAUDE_MODEL)
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', (d) => { out += d.toString(); process.stdout.write(d) })
    child.stderr.on('data', (d) => { err += d.toString(); process.stderr.write(d) })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(err || `claude exited ${code}`)))
  })
}

async function handleEvent(creds: Credentials, event: RemoteEvent) {
  await activity(creds, event.runId, `received ${event.type}`)
  const cwd = workspaceFor(event)
  const prompt = event.payload.input || ''
  const response = await runClaude(prompt, cwd)
  if (response) await agentTool(creds, event.roomId, 'chat.send', { content: response })
  await complete(creds, event.runId, { summary: response.slice(0, 500), output: response })
}

async function connect() {
  const creds = loadCredentials()
  const pollMs = Number(process.env.FREECHAT_POLL_INTERVAL_MS || 3000)
  console.log(`Connecting remote Claude Agent ${creds.agentId} to ${creds.serverUrl}`)
  while (true) {
    try {
      await heartbeat(creds)
      const events = await pollEvents(creds)
      for (const event of events) {
        try { await handleEvent(creds, event) } catch (err) { await fail(creds, event.runId, err) }
      }
    } catch (err: any) {
      console.error(`[remote-agent] ${err?.message || err}`)
    }
    await sleep(pollMs)
  }
}

async function main() {
  const cmd = process.argv[2]
  if (!cmd || cmd === 'help' || cmd === '--help') return usage()
  if (cmd === 'pair') return pair()
  if (cmd === 'connect') return connect()
  if (cmd === 'status') return console.log(JSON.stringify(loadCredentials(), null, 2))
  if (cmd === 'logout') { if (existsSync(credPath)) rmSync(credPath); return console.log('Logged out') }
  usage()
}

main().catch((err) => { console.error(err?.message || err); process.exit(1) })
