import { spawn } from 'child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentCredential, ClientConfig, RemoteEvent } from '../config/types.js'
import { workRoot } from '../config/store.js'
import { agentTool, getRuntimeSpec, type RuntimeSpec } from '../connector/api.js'

export function workspaceFor(agent: AgentCredential, event: RemoteEvent) {
  const dir = agent.workdir || join(workRoot(), event.agentId, event.roomId)
  mkdirSync(join(dir, '.freechat'), { recursive: true })
  return dir
}

function materializeCliTemplate(template: string, cfg: ClientConfig, agent: AgentCredential, event: RemoteEvent) {
  return template
    .replaceAll('__FREECHAT_API_URL__', cfg.serverUrl)
    .replaceAll('__FREECHAT_ROOM_ID__', event.roomId)
    .replaceAll('__FREECHAT_TOKEN__', agent.accessToken)
}

export function writeRunContext(cfg: ClientConfig, agent: AgentCredential, event: RemoteEvent, cwd: string, spec: RuntimeSpec) {
  const freechatDir = join(cwd, '.freechat')
  mkdirSync(freechatDir, { recursive: true })
  writeFileSync(join(freechatDir, 'run.json'), JSON.stringify({
    serverUrl: cfg.serverUrl,
    token: agent.accessToken,
    roomId: event.roomId,
    agentId: event.agentId,
    runId: event.runId,
    runtimeSpecVersion: spec.version,
    runtimeSpecChecksum: spec.checksum,
  }, null, 2))
  writeFileSync(join(cwd, 'CLAUDE.md'), spec.claudeMd, 'utf8')
  writeFileSync(join(freechatDir, 'RUNTIME.md'), spec.runtimeRules, 'utf8')
  writeFileSync(join(freechatDir, 'API.md'), spec.apiDoc, 'utf8')
  writeFileSync(join(freechatDir, 'runtime-spec.json'), JSON.stringify({ version: spec.version, checksum: spec.checksum, updatedAt: spec.updatedAt }, null, 2), 'utf8')
  writeFileSync(join(freechatDir, 'freechat.cjs'), materializeCliTemplate(spec.cliCjsTemplate, cfg, agent, event), 'utf8')
  const cli = join(cwd, 'freechat')
  writeFileSync(cli, spec.cliWrapper, 'utf8')
  try { chmodSync(cli, 0o755); chmodSync(join(freechatDir, 'freechat.cjs'), 0o755) } catch {}
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
  const spec = await getRuntimeSpec(cfg, agent)
  writeRunContext(cfg, agent, event, cwd, spec)
  const response = await runClaude(event.payload.input || '', cwd)
  const trimmed = response.trim()
  const responseMode = event.payload.responseMode || (event.type === 'agent.mentioned' ? 'final_to_chat' : 'tool_only')
  const shouldAutoSend = responseMode === 'final_to_chat' && trimmed && !/^\{\s*"success"\s*:/i.test(trimmed)
  if (shouldAutoSend) await agentTool(cfg, agent, event.roomId, 'chat.send', { content: trimmed })
  return response
}
