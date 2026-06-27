import { spawn, type ChildProcess } from 'child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join, normalize } from 'path'
import type { AgentCredential, ClientConfig, RemoteEvent } from '../config/types.js'
import { workRoot } from '../config/store.js'
import { agentTool, getAgentKnowledge, getRuntimeSpec, runActivity, type AgentKnowledgePayload, type RuntimeSpec } from '../connector/api.js'

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
  writeFileSync(join(freechatDir, 'KNOWLEDGE.md'), `# Agent 知识库

FreeChat Server 统一维护 Agent 自有知识库和通用公共知识。运行时采用按需渐进式加载，不会把知识库全文预先塞进上下文。

## 当前可用知识

- Agent ID: ${event.agentId}
- Root Agent ID: ${knowledge?.rootAgentId || event.agentId}
- Agent 自有知识文件数: ${knowledge?.summary?.fileCount || 0}
- Agent 自有知识总大小: ${knowledge?.summary?.totalSize || 0} bytes

## 使用方式

遇到产品规则、专业资料、历史背景、用户上传给 Agent 的知识、或不确定答案时，先检索再读取：

\`\`\`bash
./freechat knowledge list
./freechat knowledge search "关键词" --limit 8
./freechat knowledge read <fileId-or-path>
./freechat knowledge read public:<entryId>
\`\`\`

规则：

1. 先用 search 找 Agent 自有知识和通用公共知识的相关片段。
2. 只 read 命中的少量文件/条目；不要一次性读取全部知识库。
3. Agent 自有知识优先；通用知识作为补充。
4. 搜不到再基于当前对话回答，并说明缺少对应知识。
5. 不要把知识库全文复制到聊天，除非用户明确要求。
`, 'utf8')
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
  recoveredFromContextOverflow?: boolean
}

export type RunClaudeOptions = {
  runKey?: string
  ignorePreviousSession?: boolean
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

function sessionFileFor(cwd: string) {
  return join(cwd, '.freechat', 'claude-session.json')
}

export function isContextOverflowError(error: unknown) {
  const message = String((error as any)?.message || error || '').toLowerCase()
  return [
    'http 422',
    'status 422',
    '422',
    'context length',
    'context_length',
    'context window',
    'context too long',
    'maximum context',
    'max context',
    'prompt is too long',
    'prompt too long',
    'input is too long',
    'message is too long',
    'request too large',
    'too many tokens',
    'token limit',
    'exceeds the',
  ].some((needle) => message.includes(needle))
}

function clearSessionFile(cwd: string) {
  try { rmSync(sessionFileFor(cwd), { force: true }) } catch {}
}

function normalizeRunClaudeOptions(runKeyOrOptions?: string | RunClaudeOptions): RunClaudeOptions {
  if (typeof runKeyOrOptions === 'string') return { runKey: runKeyOrOptions }
  return runKeyOrOptions || {}
}

async function runClaudeOnce(prompt: string, cwd: string, options: RunClaudeOptions = {}): Promise<ClaudeRunResult> {
  const sessionFile = sessionFileFor(cwd)
  const sessionTtlMs = Math.max(30_000, Number(process.env.FREECHAT_AGENT_CLIENT_SESSION_TTL_MS || DEFAULT_SESSION_TTL_MS))
  let previousSessionId = ''
  try {
    if (!options.ignorePreviousSession && existsSync(sessionFile)) {
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
    if (options.runKey) activeChildren.set(options.runKey, child)
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
      if (options.runKey) activeChildren.delete(options.runKey)
      if (lineBuffer.trim()) handleLine(lineBuffer)
      if (sessionId) { try { writeFileSync(sessionFile, JSON.stringify({ sessionId, updatedAt: Date.now() }, null, 2)) } catch {} }
      if (code === 0) resolve({ response: (response || out).trim(), usage })
      else reject(new Error(err || `claude exited ${code}`))
    })
  })
}

export async function runClaude(prompt: string, cwd: string, runKeyOrOptions?: string | RunClaudeOptions): Promise<ClaudeRunResult> {
  const options = normalizeRunClaudeOptions(runKeyOrOptions)
  try {
    return await runClaudeOnce(prompt, cwd, options)
  } catch (error) {
    if (options.ignorePreviousSession || !isContextOverflowError(error)) throw error
    clearSessionFile(cwd)
    console.warn('[agent-client] Claude context exceeded; cleared saved session and retrying without --resume')
    const result = await runClaudeOnce(prompt, cwd, { ...options, ignorePreviousSession: true })
    return { ...result, recoveredFromContextOverflow: true }
  }
}

function isLikelyIntermediateProgress(text: string): boolean {
  const content = String(text || '').trim()
  if (!content) return false
  return /(?:让我|我先|我需要先|接下来|现在我|稍等|请稍等|我来|我会|正在|我将)(?:先)?(?:查看|查询|了解|检查|分析|执行|调用|处理|确认)/.test(content)
    || /(?:让我|我先).{0,20}(?:执行|查询|查看|了解)/.test(content)
}

function hasToolUse(response: string): boolean {
  return /^\s*\{\s*"success"\s*:/i.test(String(response || ''))
}

function shouldAutoSendFinal(responseMode: string, event: RemoteEvent, trimmed: string) {
  if (responseMode !== 'final_to_chat' || !trimmed || hasToolUse(trimmed)) return false
  const toolCapableSources = new Set(['handoff', 'task', 'subtask', 'task_plan', 'auto', 'agent.mentioned'])
  if (!toolCapableSources.has(String(event.payload.runSource || event.type))) return true
  return !isLikelyIntermediateProgress(trimmed)
}

export async function executeEvent(cfg: ClientConfig, agent: AgentCredential, event: RemoteEvent) {
  const cwd = workspaceFor(agent, event)
  const spec = await getRuntimeSpec(cfg, agent)
  const knowledge = await getAgentKnowledge(cfg, agent).catch((err) => {
    console.warn('[agent-client] knowledge sync failed', err?.message || err)
    return undefined
  })
  writeRunContext(cfg, agent, event, cwd, spec, knowledge)
  const responseMode = event.payload.responseMode || (event.type === 'agent.mentioned' ? 'final_to_chat' : 'tool_only')
  const mustUseTool = responseMode === 'final_to_chat'
    ? '本次为最终回复模式：如果你调用了 ./freechat chat send 或 ./freechat room handoff 等会产生用户可见消息/转接的工具，工具成功后最终 stdout 只输出一个简短结果摘要，不要重复输出已经通过工具发送的完整内容。'
    : '本次为工具模式：请优先使用 ./freechat 工具完成动作，stdout 只输出简短摘要。'
  const result = await runClaude([event.payload.input || '', mustUseTool].filter(Boolean).join('\n\n'), cwd, `${agent.agentId}:${event.runId}`)
  if (result.recoveredFromContextOverflow) {
    await runActivity(cfg, agent, event.runId, 'Claude context exceeded; cleared saved session and retried without --resume').catch(() => undefined)
  }
  const trimmed = result.response.trim()
  if (shouldAutoSendFinal(responseMode, event, trimmed)) await agentTool(cfg, agent, event.roomId, 'chat.send', { content: trimmed })
  return result
}
