import { spawn } from 'child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentCredential, ClientConfig, RemoteEvent } from '../config/types.js'
import { workRoot } from '../config/store.js'

export function workspaceFor(agent: AgentCredential, event: RemoteEvent) {
  const dir = agent.workdir || join(workRoot(), event.agentId, event.roomId)
  mkdirSync(join(dir, '.freechat'), { recursive: true })
  const cli = join(dir, 'freechat')
  writeFileSync(cli, renderFreechatCli(), 'utf8')
  try { chmodSync(cli, 0o755) } catch {}
  return dir
}

export function writeRunContext(cfg: ClientConfig, agent: AgentCredential, event: RemoteEvent, cwd: string) {
  writeFileSync(join(cwd, '.freechat', 'run.json'), JSON.stringify({
    serverUrl: cfg.serverUrl,
    token: agent.accessToken,
    roomId: event.roomId,
    agentId: event.agentId,
    runId: event.runId,
  }, null, 2))
  writeFileSync(join(cwd, 'CLAUDE.md'), `# FreeChat Agent Client\n\n你运行在用户自己的 Agent Client 中。\n\n- 使用 ./freechat chat send <内容> 回复房间。\n- 使用 ./freechat tool <action> '<jsonArgs>' 调用 FreeChat 工具。\n- 项目交付文件必须通过 FreeChat 工具写回，不能只留在本地。\n`, 'utf8')
}

function renderFreechatCli() {
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

export function runClaude(prompt: string, cwd: string): Promise<string> {
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

export async function executeEvent(cfg: ClientConfig, agent: AgentCredential, event: RemoteEvent) {
  const cwd = workspaceFor(agent, event)
  writeRunContext(cfg, agent, event, cwd)
  const response = await runClaude(event.payload.input || '', cwd)
  return response
}
