import { spawn } from 'child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentCredential, ClientConfig, RemoteEvent } from '../config/types.js'
import { workRoot } from '../config/store.js'
import { agentTool } from '../connector/api.js'

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
  writeFileSync(join(cwd, 'CLAUDE.md'), `# FreeChat Agent Client\n\n你运行在用户自己的 Agent Client 中。\n\n- 普通聊天/私聊：直接把最终回复输出到 stdout，Agent Client 会自动发回房间；不要再调用 ./freechat chat send，避免重复回复。\n- 需要中途汇报、多条消息或执行工具时，才使用 ./freechat chat send <内容> 或 ./freechat tool <action> '<jsonArgs>'。\n- 群聊/项目交付文件必须通过 FreeChat 工具写回，不能只留在本地。\n`, 'utf8')
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

const DEFAULT_SESSION_TTL_MS = 5 * 60 * 1000

export function runClaude(prompt: string, cwd: string): Promise<string> {
  const sessionFile = join(cwd, '.freechat', 'claude-session.json')
  const sessionTtlMs = Math.max(30_000, Number(process.env.FREECHAT_AGENT_CLIENT_SESSION_TTL_MS || DEFAULT_SESSION_TTL_MS))
  let previousSessionId = ''
  try {
    if (existsSync(sessionFile)) {
      const saved = JSON.parse(readFileSync(sessionFile, 'utf8'))
      if (Date.now() - Number(saved.updatedAt || 0) <= sessionTtlMs) previousSessionId = saved.sessionId || ''
      else unlinkSync(sessionFile)
    }
  } catch {}
  const args = ['-p', prompt, '--permission-mode', 'auto', '--allowedTools', 'Bash(./freechat *)', '--output-format', 'stream-json', '--verbose']
  if (previousSessionId) args.push('--resume', previousSessionId)
  if (process.env.FREECHAT_CLAUDE_MODEL) args.push('--model', process.env.FREECHAT_CLAUDE_MODEL)
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = '', lineBuffer = '', response = '', sessionId = previousSessionId
    const handleLine = (line: string) => {
      if (!line.trim()) return
      try {
        const event = JSON.parse(line)
        if (event.session_id) sessionId = event.session_id
        const msg = event.message || event
        if (Array.isArray(msg.content)) {
          for (const part of msg.content) {
            if (part?.type === 'text' && typeof part.text === 'string') response += part.text
          }
        }
        if (event.type === 'result' && typeof event.result === 'string' && !response.trim()) response = event.result
      } catch {
        response += line + '\n'
      }
    }
    child.stdout.on('data', (d) => {
      const chunk = d.toString(); process.stdout.write(chunk); out += chunk; lineBuffer += chunk
      let idx
      while ((idx = lineBuffer.indexOf('\n')) >= 0) { const line = lineBuffer.slice(0, idx); lineBuffer = lineBuffer.slice(idx + 1); handleLine(line) }
    })
    child.stderr.on('data', (d) => { err += d.toString(); process.stderr.write(d) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (lineBuffer.trim()) handleLine(lineBuffer)
      if (sessionId) { try { writeFileSync(sessionFile, JSON.stringify({ sessionId, updatedAt: Date.now() }, null, 2)) } catch {} }
      if (code === 0) resolve((response || out).trim())
      else reject(new Error(err || `claude exited ${code}`))
    })
  })
}

export async function executeEvent(cfg: ClientConfig, agent: AgentCredential, event: RemoteEvent) {
  const cwd = workspaceFor(agent, event)
  writeRunContext(cfg, agent, event, cwd)
  const response = await runClaude(event.payload.input || '', cwd)
  const trimmed = response.trim()
  const shouldAutoSend = event.type === 'agent.mentioned' && trimmed && !/^\{\s*"success"\s*:/i.test(trimmed)
  if (shouldAutoSend) await agentTool(cfg, agent, event.roomId, 'chat.send', { content: trimmed })
  return response
}
