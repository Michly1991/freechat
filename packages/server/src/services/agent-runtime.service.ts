import { spawn } from 'child_process'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { Agent } from '@freechat/shared'
import db from '../storage/db.js'
import { config } from '../config.js'
import { aiConfigService } from './ai-config.service.js'
import { roomAnalyticsService, type TokenUsage } from './room-analytics.service.js'

export interface AgentRuntimeEvent {
  type: 'activity' | 'delta'
  text: string
  kind?: string
  tool?: string
}

export class AgentRuntimeService {
/**
 * Spawn an agent to process a message.
 * Server-side agents default to Claude Code CLI with the agent private workspace as cwd.
 * Provider API is only used when AGENT_RUNTIME=provider-api.
 * Returns the agent's response text.
 */
async spawnClaudeCode(
  roomId: string,
  agentId: string,
  message: string,
  getAgent: (agentId: string) => Promise<Agent>,
  prepareAgentWorkspace: (roomId: string, agent: Agent, actorUserId?: string) => Promise<string>,
  buildAgentSystemPrompt: (agent: Agent) => string,
  options: { timeoutMs?: number; actorUserId?: string; onEvent?: (event: AgentRuntimeEvent) => void } = {}
): Promise<{ response: string; silent: boolean }> {
  const hardTimeoutMs = options.timeoutMs || config.agent.timeoutMs
  const idleTimeoutMs = config.agent.idleTimeoutMs
  const agent = await getAgent(agentId)
  const workspaceDir = await prepareAgentWorkspace(roomId, agent, options.actorUserId)
  const runId = this.createAgentRun(roomId, agentId, message, options.actorUserId)

  // Check for existing session
  const existingSession = db.prepare(`
    SELECT session_id, message_count, created_at, last_active_at FROM agent_sessions
    WHERE room_id = ? AND agent_id = ?
    ORDER BY last_active_at DESC
    LIMIT 1
  `).get(roomId, agentId) as { session_id: string; message_count: number; created_at: number; last_active_at: number } | undefined
  const sessionDecision = this.shouldRotateSession(existingSession)
  if (sessionDecision.rotate && existingSession) await this.writeSessionSummary(roomId, agentId, workspaceDir, sessionDecision.reason)

  // Optional provider API mode. Default server agent runtime is Claude Code CLI.
  if (config.agent.runtime === 'provider-api') try {
    const aiConfig = aiConfigService.getConfig()
    const provider = aiConfig.providers[aiConfig.currentProvider]
    const apiKey = aiConfigService.getApiKey(aiConfig.currentProvider)

    if (provider && provider.enabled && apiKey) {
      const agentPrompt = buildAgentSystemPrompt(agent)
      
      // Build messages array with conversation history
      const messages: any[] = []
      
      // Add recent conversation history if session exists
      if (existingSession && !sessionDecision.rotate) {
        const history = await this.getSessionHistory(existingSession.session_id, 10)
        messages.push(...history)
      }
      
      // Add current user message
      messages.push({ role: 'user', content: message })

      const response = await fetch(`${provider.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [provider.apiKeyHeader]: apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: provider.defaultModel,
          max_tokens: 4096,
          system: agentPrompt,
          messages
        })
      })

      if (response.ok) {
        const data = await response.json() as any
        const responseText = data.content?.[0]?.text || ''
        const usage = roomAnalyticsService.extractUsage(data) || undefined
        
        // Check for [SILENT] marker
        if (responseText === '[SILENT]' || responseText.includes('[SILENT]')) {
          this.finishAgentRun(runId, 'succeeded', '', undefined, sessionDecision.rotate ? undefined : existingSession?.session_id, usage, 'provider-api', provider.defaultModel)
          return { response: '', silent: true }
        }

        // Generate or reuse session ID
        const newSessionId = (!sessionDecision.rotate && existingSession?.session_id) || uuidv4()
        this.updateSession(roomId, agentId, newSessionId)
        
        // Save to conversation history
        await this.saveMessageToHistory(newSessionId, 'user', message)
        await this.saveMessageToHistory(newSessionId, 'assistant', responseText)
        this.cleanupAgentHistory(newSessionId)
        this.cleanupOldAgentSessions(roomId, agentId)
        this.finishAgentRun(runId, 'succeeded', responseText, undefined, newSessionId, usage, 'provider-api', provider.defaultModel)

        return { response: responseText, silent: false }
      } else {
        const errData = await response.json() as any
        console.error('AI provider API error:', response.status, errData)
        // Fall through to Claude Code CLI
      }
    }
  } catch (err) {
    console.error('AI provider call failed, falling back to Claude Code CLI:', err)
    // Fall through to Claude Code CLI
  }

  // Default: Use Claude Code CLI with this agent's private workspace as cwd.
  // stream-json keeps long Claude Code runs alive as long as events continue.
  const args: string[] = [
    '-p',
    message,
    '--permission-mode',
    'auto',
    '--allowedTools',
    'Bash(./freechat *)',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose'
  ]

  // Resume existing session if available
  if (existingSession && !sessionDecision.rotate) {
    args.push('--resume', existingSession.session_id)
  }

  const runClaude = (runArgs: string[]): Promise<{ response: string; silent: boolean; sessionId?: string; usage?: TokenUsage }> => new Promise((resolve, reject) => {
    const proc = spawn('claude', runArgs, {
      cwd: workspaceDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''
    let lineBuffer = ''
    let response = ''
    let sessionId: string | undefined
    let usage: TokenUsage = {}
    let settled = false
    let timedOut = false
    let hardTimer: NodeJS.Timeout | undefined
    let idleTimer: NodeJS.Timeout | undefined
    let killTimer: NodeJS.Timeout | undefined

    const cleanup = () => {
      if (hardTimer) clearTimeout(hardTimer)
      if (idleTimer) clearTimeout(idleTimer)
      if (killTimer) clearTimeout(killTimer)
    }

    const fail = (err: any) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    const succeed = (value: { response: string; silent: boolean; sessionId?: string; usage?: TokenUsage }) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    const killForTimeout = (code: string, messageText: string) => {
      timedOut = true
      const combined = `${stdout.trim()}\n${stderr.trim()}`.trim()
      try {
        if (!proc.killed) proc.kill('SIGTERM')
      } catch {}

      killTimer = setTimeout(() => {
        try {
          if (!proc.killed) proc.kill('SIGKILL')
        } catch {}
      }, config.agent.killGraceMs)

      fail({ code, message: `${messageText}. Partial output: ${combined.slice(-2000)}` })
    }

    const armIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        killForTimeout('AGENT_IDLE_TIMEOUT', `Claude Code produced no stream events for ${idleTimeoutMs}ms`)
      }, idleTimeoutMs)
    }

    hardTimer = setTimeout(() => {
      killForTimeout('AGENT_TIMEOUT', `Claude Code hard timed out after ${hardTimeoutMs}ms`)
    }, hardTimeoutMs)
    armIdleTimer()

    const emit = (event: AgentRuntimeEvent) => {
      try { options.onEvent?.(event) } catch {}
    }

    const contentText = (content: any): string => {
      if (typeof content === 'string') return content
      if (Array.isArray(content)) return content.map((item) => item?.text || '').join('')
      return ''
    }

    const handleEvent = (item: any) => {
      if (!item || typeof item !== 'object') return
      armIdleTimer()
      if (item.session_id) sessionId = item.session_id
      const eventUsage = roomAnalyticsService.extractUsage(item)
      if (eventUsage) usage = roomAnalyticsService.addUsage(usage, eventUsage)

      if (item.type === 'result') {
        response = item.result || response
        if (item.session_id) sessionId = item.session_id
        return
      }

      if (item.type === 'assistant' && item.message?.content) {
        const text = contentText(item.message.content)
        if (text) response = text
        return
      }

      if (item.type === 'stream_event') {
        const event = item.event || {}
        const deltaText = event.delta?.text || ''
        if (deltaText) {
          response += deltaText
          emit({ type: 'delta', kind: 'partial', text: response })
        }
        if (event.type === 'message_start') emit({ type: 'activity', kind: 'runtime', text: 'Claude Code 已开始生成回复' })
        return
      }

      if (item.type === 'system' && item.subtype === 'status' && item.status) {
        emit({ type: 'activity', kind: 'runtime_status', text: `Claude Code 状态：${item.status}` })
      }
    }

    const processLines = (chunk: string) => {
      lineBuffer += chunk
      const lines = lineBuffer.split(/\r?\n/)
      lineBuffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          handleEvent(JSON.parse(trimmed))
        } catch {
          // Keep raw output for diagnostics; stream-json should be JSONL.
        }
      }
    }

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString()
      stdout += text
      if (stdout.length > 1_000_000) stdout = stdout.slice(-1_000_000)
      processLines(text)
    })
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000)
      armIdleTimer()
    })

    proc.on('close', (code, signal) => {
      if (timedOut || settled) return
      processLines('\n')
      const combined = `${stdout.trim()}\n${stderr}`.trim()

      if (code !== 0) {
        fail({
          code: 'AGENT_EXECUTION_ERROR',
          message: `Claude Code exited with code ${code}${signal ? ` signal ${signal}` : ''}: ${combined}`
        })
        return
      }

      const finalResponse = response || stdout.trim()
      if (finalResponse === '[SILENT]' || finalResponse.includes('[SILENT]')) {
        succeed({ response: '', silent: true, sessionId, usage })
        return
      }

      succeed({ response: finalResponse || '', silent: false, sessionId, usage })
    })

    proc.on('error', (err) => {
      fail({ code: 'AGENT_SPAWN_ERROR', message: `Failed to spawn Claude Code: ${err.message}` })
    })
  })

  try {
    const result = await runClaude(args)
    if (result.sessionId) {
      this.updateSession(roomId, agentId, result.sessionId)
      this.cleanupAgentHistory(result.sessionId)
    }
    this.cleanupOldAgentSessions(roomId, agentId)
    this.finishAgentRun(runId, 'succeeded', result.response, undefined, result.sessionId, result.usage, 'claude-code')
    return { response: result.response, silent: result.silent }
  } catch (err: any) {
    if (existingSession && !sessionDecision.rotate && String(err.message || '').includes('No conversation found')) {
      const freshArgs = args.filter((arg, index) => arg !== '--resume' && args[index - 1] !== '--resume')
      const result = await runClaude(freshArgs)
      if (result.sessionId) {
        this.updateSession(roomId, agentId, result.sessionId)
        this.cleanupAgentHistory(result.sessionId)
      }
      this.cleanupOldAgentSessions(roomId, agentId)
      this.finishAgentRun(runId, 'succeeded', result.response, undefined, result.sessionId, result.usage, 'claude-code')
      return { response: result.response, silent: result.silent }
    }
    this.finishAgentRun(runId, err?.code === 'AGENT_TIMEOUT' || err?.code === 'AGENT_IDLE_TIMEOUT' ? 'timeout' : 'failed', undefined, err?.message || String(err), sessionDecision.rotate ? undefined : existingSession?.session_id)
    throw err
  }
}


private shouldRotateSession(session?: { session_id: string; message_count: number; created_at: number; last_active_at: number }): { rotate: boolean; reason?: string } {
  if (!session) return { rotate: false }
  const maxRuns = Math.max(1, config.agent.sessionMaxRuns)
  if ((session.message_count || 0) >= maxRuns) return { rotate: true, reason: `message_count ${session.message_count} >= ${maxRuns}` }
  const maxAgeMs = Math.max(1, config.agent.sessionMaxAgeHours) * 60 * 60 * 1000
  const age = Date.now() - Number(session.created_at || Date.now())
  if (age >= maxAgeMs) return { rotate: true, reason: `session age ${Math.round(age / 3600000)}h >= ${config.agent.sessionMaxAgeHours}h` }
  return { rotate: false }
}

private async writeSessionSummary(roomId: string, agentId: string, workspaceDir: string, reason = 'rotation'): Promise<void> {
  try {
    const rows = db.prepare(`
      SELECT status, input, output, error, started_at, finished_at
      FROM agent_runs
      WHERE room_id = ? AND agent_id = ?
      ORDER BY started_at DESC
      LIMIT 12
    `).all(roomId, agentId) as any[]
    const lines = rows.map((row) => [
      `- ${new Date(row.started_at).toISOString()} · ${row.status}`,
      `  - 输入：${String(row.input || '').replace(/\s+/g, ' ').slice(0, 180)}`,
      row.output ? `  - 输出摘要：${String(row.output).replace(/\s+/g, ' ').slice(0, 220)}` : '',
      row.error ? `  - 错误：${String(row.error).replace(/\s+/g, ' ').slice(0, 220)}` : '',
    ].filter(Boolean).join('\n')).join('\n')
    const content = [`# Agent 会话摘要`, '', `更新时间：${new Date().toISOString()}`, `轮换原因：${reason}`, '', '此文件用于替代过长的 Claude Code resume 历史。新会话应优先读取当前结构化上下文、任务状态、TAB_FILES.md 和本摘要，不要依赖旧长会话。', '', '## 最近运行', '', lines || '- 暂无运行记录。', ''].join('\n')
    const dir = join(workspaceDir, '.freechat')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SESSION_SUMMARY.md'), content, 'utf8')
  } catch (err) {
    console.error('Failed to write agent session summary:', err)
  }
}

private createAgentRun(roomId: string, agentId: string, input: string, actorUserId?: string): string {
  const id = `arun_${uuidv4()}`
  db.prepare(`
    INSERT INTO agent_runs (id, room_id, agent_id, status, input, actor_user_id, started_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `).run(id, roomId, agentId, input, actorUserId || null, Date.now())
  return id
}

private finishAgentRun(runId: string, status: 'succeeded' | 'failed' | 'timeout' | 'cancelled', output?: string, error?: string, sessionId?: string, usage: TokenUsage = {}, runtime?: string, model?: string): void {
  const now = Date.now()
  const row = db.prepare('SELECT started_at FROM agent_runs WHERE id = ?').get(runId) as { started_at: number } | undefined
  const durationMs = row ? Math.max(0, now - Number(row.started_at || now)) : null
  const totalTokens = roomAnalyticsService.totalTokens(usage)
  db.prepare(`
    UPDATE agent_runs
    SET status = ?, output = ?, error = ?, session_id = ?, runtime = COALESCE(?, runtime), model = COALESCE(?, model),
        duration_ms = ?, input_tokens = ?, output_tokens = ?, cache_creation_input_tokens = ?, cache_read_input_tokens = ?, total_tokens = ?, finished_at = ?
    WHERE id = ?
  `).run(status, output || null, error || null, sessionId || null, runtime || null, model || null, durationMs, usage.inputTokens || 0, usage.outputTokens || 0, usage.cacheCreationInputTokens || 0, usage.cacheReadInputTokens || 0, totalTokens, now, runId)
}

/**
 * Update or create an agent session record
 */
private updateSession(roomId: string, agentId: string, sessionId?: string): void {
  if (!sessionId) return

  const now = Date.now()
  const existing = db.prepare(`
    SELECT id, message_count FROM agent_sessions
    WHERE room_id = ? AND agent_id = ? AND session_id = ?
  `).get(roomId, agentId, sessionId) as { id: string; message_count: number } | undefined

  if (existing) {
    db.prepare(`
      UPDATE agent_sessions SET message_count = ?, last_active_at = ? WHERE id = ?
    `).run(existing.message_count + 1, now, existing.id)
  } else {
    const id = `asess_${uuidv4()}`
    db.prepare(`
      INSERT INTO agent_sessions (id, room_id, agent_id, session_id, message_count, created_at, last_active_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(id, roomId, agentId, sessionId, now, now)
  }
}

/**
 * Get conversation history for a session
 */
private async getSessionHistory(sessionId: string, limit: number = 10): Promise<any[]> {
  try {
    const messages = db.prepare(`
      SELECT role, content FROM agent_messages
      WHERE session_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(sessionId, limit) as { role: string; content: string }[]

    return messages.map(m => ({ role: m.role, content: m.content }))
  } catch (err) {
    // Table might not exist yet
    return []
  }
}

/**
 * Save a message to conversation history
 */
private async saveMessageToHistory(sessionId: string, role: string, content: string): Promise<void> {
  try {
    const id = `amsg_${uuidv4()}`
    const now = Date.now()
    
    db.prepare(`
      INSERT INTO agent_messages (id, session_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, sessionId, role, content, now)
  } catch (err) {
    console.error('Failed to save message to history:', err)
  }
}

private cleanupAgentHistory(sessionId: string): void {
  try {
    const limit = Math.max(1, config.agent.historyLimit)
    const count = db.prepare('SELECT COUNT(*) as count FROM agent_messages WHERE session_id = ?').get(sessionId) as { count: number }
    if (!count || count.count <= limit) return

    const stale = db.prepare(`
      SELECT id FROM agent_messages
      WHERE session_id = ?
      ORDER BY created_at ASC
      LIMIT ?
    `).all(sessionId, count.count - limit) as { id: string }[]

    if (stale.length > 0) {
      db.prepare(`DELETE FROM agent_messages WHERE id IN (${stale.map(() => '?').join(',')})`).run(...stale.map((m) => m.id))
    }
  } catch (err) {
    console.error('Failed to cleanup agent history:', err)
  }
}

private cleanupOldAgentSessions(roomId: string, agentId: string): void {
  try {
    const retentionMs = Math.max(1, config.agent.sessionRetentionDays) * 24 * 60 * 60 * 1000
    const cutoff = Date.now() - retentionMs
    const oldSessions = db.prepare(`
      SELECT session_id FROM agent_sessions
      WHERE room_id = ? AND agent_id = ? AND last_active_at < ?
    `).all(roomId, agentId, cutoff) as { session_id: string }[]

    if (oldSessions.length === 0) return
    const sessionIds = oldSessions.map((s) => s.session_id)
    db.prepare(`DELETE FROM agent_messages WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`).run(...sessionIds)
    db.prepare(`DELETE FROM agent_sessions WHERE room_id = ? AND agent_id = ? AND session_id IN (${sessionIds.map(() => '?').join(',')})`).run(roomId, agentId, ...sessionIds)
  } catch (err) {
    console.error('Failed to cleanup old agent sessions:', err)
  }
}

}
