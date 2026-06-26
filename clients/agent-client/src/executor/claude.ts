import { spawn, type ChildProcess } from 'child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join, normalize } from 'path'
import type { AgentCredential, ClientConfig, RemoteEvent } from '../config/types.js'
import { workRoot } from '../config/store.js'
import { agentTool, getAgentKnowledge, getRuntimeSpec, type AgentKnowledgePayload, type RuntimeSpec } from '../connector/api.js'

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

function writeKnowledgeFiles(targetDir: string, knowledge?: AgentKnowledgePayload) {
  rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(targetDir, { recursive: true })
  const root = normalize(targetDir)
  for (const file of knowledge?.files || []) {
    const rel = String(file.path || file.name || '').replace(/\\/g, '/').split('/').filter((part) => part && part !== '.' && part !== '..').join('/')
    if (!rel) continue
    const full = normalize(join(targetDir, rel))
    if (!full.startsWith(root)) continue
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, file.content || '', 'utf8')
  }
}

export function writeRunContext(cfg: ClientConfig, agent: AgentCredential, event: RemoteEvent, cwd: string, spec: RuntimeSpec, knowledge?: AgentKnowledgePayload) {
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
  const knowledgeDir = join(freechatDir, 'knowledge')
  writeKnowledgeFiles(knowledgeDir, knowledge)
  writeFileSync(join(freechatDir, 'runtime-spec.json'), JSON.stringify({ version: spec.version, checksum: spec.checksum, updatedAt: spec.updatedAt, knowledgeDir, knowledgeSummary: knowledge?.summary || null }, null, 2), 'utf8')
  writeFileSync(join(freechatDir, 'KNOWLEDGE.md'), `# Agent 知识库\n\n本 Agent 的知识库由 FreeChat Server 维护，运行前已同步到本地目录：\n\n${knowledgeDir}\n\n文件数量：${knowledge?.summary?.fileCount || 0}\n\n如任务需要背景资料，请优先按需读取该目录中的 Markdown / 文本文件。不要把知识库文件复制到聊天，除非用户明确要求。\n`, 'utf8')
  writeFileSync(join(freechatDir, 'freechat.cjs'), materializeCliTemplate(spec.cliCjsTemplate, cfg, agent, event), 'utf8')
  const cli = join(cwd, 'freechat')
  writeFileSync(cli, spec.cliWrapper, 'utf8')
  try { chmodSync(cli, 0o755); chmodSync(join(freechatDir, 'freechat.cjs'), 0o755) } catch {}
}

const DEFAULT_SESSION_TTL_MS = 5 * 60 * 1000

export type ClaudeUsage = {
  model?: string
  inputTokens: number
  outputTokens: number
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  totalTokens: number
  raw?: any
}

export type ClaudeRunResult = {
  response: string
  usage: ClaudeUsage
}

const activeChildren = new Map<string, ChildProcess>()

export function abortAgentRuns(agentId: string, reason = 'Agent restart requested') {
  for (const [key, child] of activeChildren) {
    if (!key.startsWith(`${agentId}:`)) continue
    try { child.kill('SIGTERM') } catch {}
    setTimeout(() => { if (!child.killed) { try { child.kill('SIGKILL') } catch {} } }, 2000).unref?.()
  }
}

export function clearAgentSession(agent: AgentCredential, roomId?: string) {
  const targets = roomId ? [join(workRoot(), agent.agentId, roomId)] : [join(workRoot(), agent.agentId)]
  for (const target of targets) {
    if (roomId) rmSync(join(target, '.freechat', 'claude-session.json'), { force: true })
    else {
      try {
        const rooms = existsSync(target) ? readdirSync(target) : []
        for (const room of rooms) rmSync(join(target, room, '.freechat', 'claude-session.json'), { force: true })
      } catch {}
    }
  }
}

function num(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
}

function mergeUsage(current: ClaudeUsage, raw: any, model?: string): ClaudeUsage {
  const next = raw || {}
  const inputTokens = num(next.input_tokens ?? next.inputTokens ?? next.prompt_tokens ?? next.promptTokens)
  const outputTokens = num(next.output_tokens ?? next.outputTokens ?? next.completion_tokens ?? next.completionTokens)
  const cacheCreationInputTokens = num(next.cache_creation_input_tokens ?? next.cacheCreationInputTokens ?? next.cache_write_tokens ?? next.cacheWriteTokens)
  const cacheReadInputTokens = num(next.cache_read_input_tokens ?? next.cacheReadInputTokens ?? next.cache_read_tokens ?? next.cacheReadTokens)
  const totalTokens = num(next.total_tokens ?? next.totalTokens) || (inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens)
  if (totalTokens <= current.totalTokens) return { ...current, model: current.model || model || next.model }
  return { model: model || next.model || current.model, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, totalTokens, raw: next }
}

export function runClaude(prompt: string, cwd: string, runKey?: string): Promise<ClaudeRunResult> {
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
    if (runKey) activeChildren.set(runKey, child)
    let out = '', err = '', lineBuffer = '', response = '', sessionId = previousSessionId
    let usage: ClaudeUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, totalTokens: 0 }
    const handleLine = (line: string) => {
      if (!line.trim()) return
      try {
        const event = JSON.parse(line)
        if (event.session_id) sessionId = event.session_id
        const eventModel = event.model || event.message?.model
        if (event.usage) usage = mergeUsage(usage, event.usage, eventModel)
        if (event.message?.usage) usage = mergeUsage(usage, event.message.usage, eventModel)
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
      if (runKey) activeChildren.delete(runKey)
      if (lineBuffer.trim()) handleLine(lineBuffer)
      if (sessionId) { try { writeFileSync(sessionFile, JSON.stringify({ sessionId, updatedAt: Date.now() }, null, 2)) } catch {} }
      if (code === 0) resolve({ response: (response || out).trim(), usage })
      else reject(new Error(err || `claude exited ${code}`))
    })
  })
}

export async function executeEvent(cfg: ClientConfig, agent: AgentCredential, event: RemoteEvent) {
  const cwd = workspaceFor(agent, event)
  const spec = await getRuntimeSpec(cfg, agent)
  const knowledge = await getAgentKnowledge(cfg, agent).catch((err) => {
    console.warn('[agent-client] knowledge sync failed', err?.message || err)
    return undefined
  })
  writeRunContext(cfg, agent, event, cwd, spec, knowledge)
  const result = await runClaude(event.payload.input || '', cwd, `${agent.agentId}:${event.runId}`)
  const trimmed = result.response.trim()
  const responseMode = event.payload.responseMode || (event.type === 'agent.mentioned' ? 'final_to_chat' : 'tool_only')
  const shouldAutoSend = responseMode === 'final_to_chat' && trimmed && !/^\{\s*"success"\s*:/i.test(trimmed)
  if (shouldAutoSend) await agentTool(cfg, agent, event.roomId, 'chat.send', { content: trimmed })
  return result
}
