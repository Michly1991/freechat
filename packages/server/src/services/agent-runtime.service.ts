import { spawn } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import type { Agent } from '@freechat/shared'
import db from '../storage/db.js'
import { config } from '../config.js'
import { aiConfigService } from './ai-config.service.js'

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
  prepareAgentWorkspace: (roomId: string, agent: Agent) => Promise<string>,
  buildAgentSystemPrompt: (agent: Agent) => string,
  options: { timeoutMs?: number } = {}
): Promise<{ response: string; silent: boolean }> {
  const timeoutMs = options.timeoutMs || config.agent.timeoutMs
  const agent = await getAgent(agentId)
  const workspaceDir = await prepareAgentWorkspace(roomId, agent)
  const runId = this.createAgentRun(roomId, agentId, message)

  // Check for existing session
  const existingSession = db.prepare(`
    SELECT session_id FROM agent_sessions
    WHERE room_id = ? AND agent_id = ?
    ORDER BY last_active_at DESC
    LIMIT 1
  `).get(roomId, agentId) as { session_id: string } | undefined

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
      if (existingSession) {
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
        
        // Check for [SILENT] marker
        if (responseText === '[SILENT]' || responseText.includes('[SILENT]')) {
          this.finishAgentRun(runId, 'succeeded', '', undefined, existingSession?.session_id)
          return { response: '', silent: true }
        }

        // Generate or reuse session ID
        const newSessionId = existingSession?.session_id || uuidv4()
        this.updateSession(roomId, agentId, newSessionId)
        
        // Save to conversation history
        await this.saveMessageToHistory(newSessionId, 'user', message)
        await this.saveMessageToHistory(newSessionId, 'assistant', responseText)
        this.cleanupAgentHistory(newSessionId)
        this.cleanupOldAgentSessions(roomId, agentId)
        this.finishAgentRun(runId, 'succeeded', responseText, undefined, newSessionId)

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

  // Default: Use Claude Code CLI with this agent's private workspace as cwd
  const args: string[] = [
    '-p',
    message,
    '--permission-mode',
    'auto',
    '--allowedTools',
    'Bash(./freechat *)',
    '--output-format',
    'json'
  ]

  // Resume existing session if available
  if (existingSession) {
    args.push('--resume', existingSession.session_id)
  }

  const runClaude = (runArgs: string[]): Promise<{ response: string; silent: boolean; sessionId?: string }> => new Promise((resolve, reject) => {
    const proc = spawn('claude', runArgs, {
      cwd: workspaceDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let killTimer: NodeJS.Timeout | undefined

    const cleanup = () => {
      if (watchdog) clearTimeout(watchdog)
      if (killTimer) clearTimeout(killTimer)
    }

    const fail = (err: any) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    const succeed = (value: { response: string; silent: boolean; sessionId?: string }) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }

    const watchdog = setTimeout(() => {
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

      fail({
        code: 'AGENT_TIMEOUT',
        message: `Claude Code timed out after ${timeoutMs}ms. Partial output: ${combined.slice(-2000)}`
      })
    }, timeoutMs)

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
      if (stdout.length > 1_000_000) stdout = stdout.slice(-1_000_000)
    })
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000)
    })

    proc.on('close', (code, signal) => {
      if (timedOut || settled) return
      const raw = stdout.trim()
      const combined = `${raw}\n${stderr}`.trim()

      if (code !== 0) {
        fail({
          code: 'AGENT_EXECUTION_ERROR',
          message: `Claude Code exited with code ${code}${signal ? ` signal ${signal}` : ''}: ${combined}`
        })
        return
      }

      let response = raw
      let sessionId: string | undefined
      try {
        const parsed = JSON.parse(raw)
        response = parsed.result || ''
        sessionId = parsed.session_id
      } catch {
        const sessionMatch = raw.match(/session[_-]?id[:\s]+([^\s]+)/i)
        sessionId = sessionMatch?.[1]
      }

      if (response === '[SILENT]' || response.includes('[SILENT]')) {
        succeed({ response: '', silent: true, sessionId })
        return
      }

      succeed({ response: response || '', silent: false, sessionId })
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
    this.finishAgentRun(runId, 'succeeded', result.response, undefined, result.sessionId)
    return { response: result.response, silent: result.silent }
  } catch (err: any) {
    if (existingSession && String(err.message || '').includes('No conversation found')) {
      const freshArgs = args.filter((arg, index) => arg !== '--resume' && args[index - 1] !== '--resume')
      const result = await runClaude(freshArgs)
      if (result.sessionId) {
        this.updateSession(roomId, agentId, result.sessionId)
        this.cleanupAgentHistory(result.sessionId)
      }
      this.cleanupOldAgentSessions(roomId, agentId)
      this.finishAgentRun(runId, 'succeeded', result.response, undefined, result.sessionId)
      return { response: result.response, silent: result.silent }
    }
    this.finishAgentRun(runId, err?.code === 'AGENT_TIMEOUT' ? 'timeout' : 'failed', undefined, err?.message || String(err), existingSession?.session_id)
    throw err
  }
}

private createAgentRun(roomId: string, agentId: string, input: string): string {
  const id = `arun_${uuidv4()}`
  db.prepare(`
    INSERT INTO agent_runs (id, room_id, agent_id, status, input, started_at)
    VALUES (?, ?, ?, 'running', ?, ?)
  `).run(id, roomId, agentId, input, Date.now())
  return id
}

private finishAgentRun(runId: string, status: 'succeeded' | 'failed' | 'timeout' | 'cancelled', output?: string, error?: string, sessionId?: string): void {
  db.prepare(`
    UPDATE agent_runs
    SET status = ?, output = ?, error = ?, session_id = ?, finished_at = ?
    WHERE id = ?
  `).run(status, output || null, error || null, sessionId || null, Date.now(), runId)
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
