import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { spawn } from 'child_process'
import { chmod, mkdir, readdir, rename, writeFile } from 'fs/promises'
import { join } from 'path'
import { config } from '../config.js'
import { aiConfigService } from './ai-config.service.js'
import { createAgentToolToken } from '../agent-tool-token.js'
import type { Agent } from '@freechat/shared'

// Shape of an agent row in the DB
interface AgentRow {
  id: string
  owner_id: string
  name: string
  role_type: string
  deployment: string
  description: string | null
  specialties: string | null
  config: string | null
  api_key_hash: string | null
  status: string
  session_id: string | null
  created_at: number
  updated_at: number
}

export interface AgentConfig {
  name: string
  roleType: 'assistant' | 'specialist'
  deployment: 'server' | 'client'
  description?: string
  specialties?: string[]
  config?: Record<string, any>
  status?: 'active' | 'inactive' | 'working'
}

export interface AgentCreateResult {
  agent: Agent
  apiKey: string // Only returned once at creation
}

export class AgentService {
  /**
   * Create a new agent. Returns the plaintext api_key once.
   */
  async createAgent(ownerId: string, cfg: AgentConfig): Promise<AgentCreateResult> {
    const id = `agent_${uuidv4()}`
    const now = Date.now()

    // Generate API key
    const apiKey = `fc_${crypto.randomBytes(32).toString('hex')}`
    const apiKeyHash = await bcrypt.hash(apiKey, 10)

    db.prepare(`
      INSERT INTO agents (id, owner_id, name, role_type, deployment, description, specialties, config, api_key_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(
      id,
      ownerId,
      cfg.name,
      cfg.roleType,
      cfg.deployment,
      cfg.description || null,
      cfg.specialties ? JSON.stringify(cfg.specialties) : null,
      cfg.config ? JSON.stringify(cfg.config) : null,
      apiKeyHash,
      now,
      now
    )

    const agent = this.rowToAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow)
    return { agent, apiKey }
  }

  /**
   * Get agent by ID
   */
  async getAgent(agentId: string): Promise<Agent> {
    const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined
    if (!row) {
      throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    }
    return this.rowToAgent(row)
  }

  /**
   * List all agents owned by a user
   */
  async getUserAgents(ownerId: string): Promise<Agent[]> {
    const rows = db.prepare('SELECT * FROM agents WHERE owner_id = ? ORDER BY created_at DESC').all(ownerId) as AgentRow[]
    return rows.map(r => this.rowToAgent(r))
  }

  /**
   * Update agent fields
   */
  async updateAgent(agentId: string, updates: Partial<AgentConfig>): Promise<Agent> {
    const fields: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) {
      fields.push('name = ?')
      values.push(updates.name)
    }
    if (updates.roleType !== undefined) {
      fields.push('role_type = ?')
      values.push(updates.roleType)
    }
    if (updates.deployment !== undefined) {
      fields.push('deployment = ?')
      values.push(updates.deployment)
    }
    if (updates.description !== undefined) {
      fields.push('description = ?')
      values.push(updates.description)
    }
    if (updates.specialties !== undefined) {
      fields.push('specialties = ?')
      values.push(JSON.stringify(updates.specialties))
    }
    if (updates.config !== undefined) {
      fields.push('config = ?')
      values.push(JSON.stringify(updates.config))
    }
    if (updates.status !== undefined) {
      fields.push('status = ?')
      values.push(updates.status)
    }

    if (fields.length === 0) {
      return this.getAgent(agentId)
    }

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(agentId)

    db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    return this.getAgent(agentId)
  }

  /**
   * Delete agent
   */
  async deleteAgent(agentId: string): Promise<void> {
    db.prepare('DELETE FROM agents WHERE id = ?').run(agentId)
  }

  /**
   * Regenerate API key for an agent. Returns the new plaintext key once.
   */
  async regenerateApiKey(agentId: string): Promise<string> {
    const row = db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId) as AgentRow | undefined
    if (!row) {
      throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    }

    const apiKey = `fc_${crypto.randomBytes(32).toString('hex')}`
    const apiKeyHash = await bcrypt.hash(apiKey, 10)

    db.prepare('UPDATE agents SET api_key_hash = ?, updated_at = ? WHERE id = ?')
      .run(apiKeyHash, Date.now(), agentId)

    return apiKey
  }

  /**
   * Validate an API key and return the agent if valid
   */
  async validateApiKey(apiKey: string): Promise<Agent | null> {
    // Find agents that have an api_key_hash
    const rows = db.prepare('SELECT * FROM agents WHERE api_key_hash IS NOT NULL').all() as AgentRow[]
    for (const row of rows) {
      const valid = await bcrypt.compare(apiKey, row.api_key_hash!)
      if (valid) {
        return this.rowToAgent(row)
      }
    }
    return null
  }

  /**
   * Add an agent to a room
   */
  async addAgentToRoom(roomId: string, agentId: string, addedBy: string): Promise<void> {
    const now = Date.now()
    db.prepare(`
      INSERT OR REPLACE INTO room_agents (room_id, agent_id, added_by, added_at)
      VALUES (?, ?, ?, ?)
    `).run(roomId, agentId, addedBy, now)

    // Don't add to room_members since agents are not in users table
    // Agent membership is tracked via room_agents table
  }

  /**
   * Remove an agent from a room
   */
  async removeAgentFromRoom(roomId: string, agentId: string): Promise<void> {
    db.prepare('DELETE FROM room_agents WHERE room_id = ? AND agent_id = ?').run(roomId, agentId)
    db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ? AND type = ?').run(roomId, agentId, 'agent')
  }

  /**
   * List agents in a room
   */
  async getRoomAgents(roomId: string): Promise<Agent[]> {
    const rows = db.prepare(`
      SELECT a.* FROM agents a
      INNER JOIN room_agents ra ON a.id = ra.agent_id
      WHERE ra.room_id = ?
      ORDER BY ra.added_at ASC
    `).all(roomId) as AgentRow[]
    return rows.map(r => this.rowToAgent(r))
  }

  private async syncMisplacedWorkspaceFiles(roomId: string): Promise<string[]> {
    const workspaceDir = join(config.workspace.root, roomId)
    const filesDir = join(workspaceDir, 'files')
    await mkdir(filesDir, { recursive: true })

    const reserved = new Set(['AGENTS.md', 'freechat', 'files'])
    const entries = await readdir(workspaceDir, { withFileTypes: true })
    const moved: string[] = []

    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (reserved.has(entry.name) || entry.name.startsWith('.')) continue

      const from = join(workspaceDir, entry.name)
      const to = join(filesDir, entry.name)
      await rename(from, to)
      moved.push(entry.name)
    }

    return moved
  }

  private async prepareRoomWorkspace(roomId: string, agent: Agent): Promise<string> {
    const workspaceDir = join(config.workspace.root, roomId)
    const metaDir = join(workspaceDir, '.freechat')
    await mkdir(metaDir, { recursive: true })

    const toolToken = createAgentToolToken(roomId, agent.id)
    const toolApiUrl = `http://127.0.0.1:${config.port}`
    const room = db.prepare('SELECT id, name, description, created_by, created_at, updated_at FROM rooms WHERE id = ?').get(roomId) as any
    const members = db.prepare(`
      SELECT rm.role, rm.joined_at, u.username, u.nickname
      FROM room_members rm
      INNER JOIN users u ON rm.user_id = u.id
      WHERE rm.room_id = ?
      ORDER BY rm.joined_at ASC
    `).all(roomId) as any[]
    const agents = await this.getRoomAgents(roomId)

    const cliPath = join(workspaceDir, 'freechat')
    await writeFile(cliPath, `#!/usr/bin/env node
const API_URL = ${JSON.stringify(toolApiUrl)};
const ROOM_ID = ${JSON.stringify(roomId)};
const TOKEN = ${JSON.stringify(toolToken)};

async function call(action, args = {}) {
  const res = await fetch(\`${toolApiUrl}/api/agent-tools/${roomId}\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: \`Bearer ${toolToken}\` },
    body: JSON.stringify({ action, args })
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { success: false, raw: text }; }
  if (!res.ok || data.success === false) {
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(data.data ?? data, null, 2));
}

function pairsToObject(items) {
  const out = {};
  for (let i = 0; i < items.length; i += 2) out[items[i]] = items[i + 1];
  return out;
}

const [domain, cmd, ...rest] = process.argv.slice(2);
if (!domain || ['-h', '--help', 'help'].includes(domain)) {
  console.log(\`FreeChat Agent CLI

Commands:
  ./freechat chat send <content>
  ./freechat task list [status]
  ./freechat task create <title> [description]
  ./freechat task update <taskId> <field> <value> [field value...]
  ./freechat file list
  ./freechat file read <path>
  ./freechat file write <path> <content>
  ./freechat members list
  ./freechat room info
  ./freechat raw <action> '<jsonArgs>'
\`);
  process.exit(0);
}

if (domain === 'chat' && cmd === 'send') call('chat.send', { content: rest.join(' ') });
else if (domain === 'task' && cmd === 'list') call('task.list', { status: rest[0] });
else if (domain === 'task' && cmd === 'create') call('task.create', { title: rest[0], description: rest.slice(1).join(' ') || undefined });
else if (domain === 'task' && cmd === 'update') call('task.update', { taskId: rest[0], updates: pairsToObject(rest.slice(1)) });
else if (domain === 'file' && cmd === 'list') call('file.list');
else if (domain === 'file' && cmd === 'read') call('file.read', { path: rest[0] });
else if (domain === 'file' && cmd === 'write') call('file.write', { path: rest[0], content: rest.slice(1).join(' ') });
else if (domain === 'members' && cmd === 'list') call('members.list');
else if (domain === 'room' && cmd === 'info') call('room.info');
else if (domain === 'raw') call(cmd, rest[0] ? JSON.parse(rest[0]) : {});
else {
  console.error('Unknown command. Run ./freechat help');
  process.exit(1);
}
`, 'utf8')
    await chmod(cliPath, 0o700)

    await writeFile(join(workspaceDir, 'AGENTS.md'), `# FreeChat Agent Workspace\n\n你正在 FreeChat 项目工作区内运行。\n\n- 当前目录就是项目根目录。\n- 优先阅读 .freechat/ 下的上下文文件。\n- 必须使用根目录的 \`./freechat\` CLI 同步对话、任务、文件和成员信息。\n- 用户可见的项目文件必须通过 \`./freechat file read/write/list\` 读写；不要用 shell 重定向、cat/echo、Write/Edit 等方式直接创建或读取业务文件。\n- \`./freechat file write <path> <content>\` 写入的是前端文件面板可见的项目文件区；\`./freechat file read <path>\` 也从这个文件区读取。\n- 复杂任务要先 \`./freechat chat send\` 汇报开始，再用 \`./freechat task create/update\` 同步进度，必要时用 \`./freechat file read/write\` 读写资料，完成后发总结。\n- 不要越权操作，不要删除用户资料。\n- 如果你是助理 Agent，可以做总结、协调和拍板；专家 Agent 只负责专业执行和同步状态。\n`, 'utf8')

    await writeFile(join(metaDir, 'ROOM.md'), `# Room Context\n\n- Room ID: ${roomId}\n- Name: ${room?.name || ''}\n- Description: ${room?.description || ''}\n- Current Agent: ${agent.name}\n- Agent ID: ${agent.id}\n- Agent Role: ${agent.roleType}\n`, 'utf8')

    await writeFile(join(metaDir, 'MEMBERS.md'), `# Members\n\n## Humans\n${members.map((m) => `- ${m.nickname || m.username} (@${m.username}) - ${m.role}`).join('\n') || '- none'}\n\n## Agents\n${agents.map((a) => `- ${a.name} (${a.roleType}) - ${a.status || 'active'}`).join('\n') || '- none'}\n`, 'utf8')

    await writeFile(join(metaDir, 'API.md'), `# FreeChat CLI Contract\n\nAgent 必须通过根目录的 \`./freechat\` CLI 同步工作进度：\n\n\`\`\`bash\n./freechat chat send "我开始处理这个任务"\n./freechat task list\n./freechat task create "拆分任务标题" "任务说明"\n./freechat task update <taskId> status doing\n./freechat task update <taskId> status review reviewNote "已完成，等待确认"\n./freechat task update <taskId> status done\n./freechat file list\n./freechat file read docs/example.md\n./freechat file write docs/progress.md "进度内容"\n./freechat members list\n./freechat room info\n\`\`\`\n\n规则：\n\n- 长任务开始时先发消息，再创建/更新任务。\n- 处理中把任务设为 doing，完成后设为 review 或 done。\n- 阻塞时设为 blocked 并写 blockedReason。\n- 文件写入必须通过 \`./freechat file write\`，文件读取必须通过 \`./freechat file read\`。\n- 不要直接在房间根目录创建业务文件；如果误写，服务端会在 Agent 执行结束后尝试移动到 files 区，但这只是兜底。\n`, 'utf8')

    return workspaceDir
  }

  /**
   * Spawn an agent to process a message.
   * Server-side agents default to Claude Code CLI with the room workspace as cwd.
   * Provider API is only used when AGENT_RUNTIME=provider-api.
   * Returns the agent's response text.
   */
  async spawnClaudeCode(
    roomId: string,
    agentId: string,
    message: string
  ): Promise<{ response: string; silent: boolean; movedFiles?: string[] }> {
    const agent = await this.getAgent(agentId)
    const workspaceDir = await this.prepareRoomWorkspace(roomId, agent)

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
        const agentPrompt = agent.config?.systemPrompt || agent.description || 'You are a helpful AI assistant.'
        
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
            return { response: '', silent: true }
          }

          // Generate or reuse session ID
          const newSessionId = existingSession?.session_id || uuidv4()
          this.updateSession(roomId, agentId, newSessionId)
          
          // Save to conversation history
          await this.saveMessageToHistory(newSessionId, 'user', message)
          await this.saveMessageToHistory(newSessionId, 'assistant', responseText)

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

    // Default: Use Claude Code CLI with room workspace as project root
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
        env: { ...process.env },
        timeout: 120_000, // 2 min timeout
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

      proc.on('close', (code) => {
        const raw = stdout.trim()
        const combined = `${raw}\n${stderr}`.trim()

        if (code !== 0) {
          reject({
            code: 'AGENT_EXECUTION_ERROR',
            message: `Claude Code exited with code ${code}: ${combined}`
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
          resolve({ response: '', silent: true, sessionId })
          return
        }

        resolve({ response: response || '', silent: false, sessionId })
      })

      proc.on('error', (err) => {
        reject({ code: 'AGENT_SPAWN_ERROR', message: `Failed to spawn Claude Code: ${err.message}` })
      })
    })

    try {
      const result = await runClaude(args)
      if (result.sessionId) this.updateSession(roomId, agentId, result.sessionId)
      const movedFiles = await this.syncMisplacedWorkspaceFiles(roomId)
      return { response: result.response, silent: result.silent, movedFiles }
    } catch (err: any) {
      if (existingSession && String(err.message || '').includes('No conversation found')) {
        const freshArgs = args.filter((arg, index) => arg !== '--resume' && args[index - 1] !== '--resume')
        const result = await runClaude(freshArgs)
        if (result.sessionId) this.updateSession(roomId, agentId, result.sessionId)
        const movedFiles = await this.syncMisplacedWorkspaceFiles(roomId)
        return { response: result.response, silent: result.silent, movedFiles }
      }
      throw err
    }
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

  /**
   * Convert a DB row to an Agent object
   */
  private rowToAgent(row: AgentRow): Agent {
    return {
      id: row.id,
      name: row.name,
      roleType: row.role_type as 'assistant' | 'specialist',
      deployment: row.deployment as 'server' | 'client',
      description: row.description || undefined,
      specialties: row.specialties ? JSON.parse(row.specialties) : undefined,
      config: row.config ? JSON.parse(row.config) : undefined,
      status: (row.status as 'active' | 'inactive' | 'working') || 'active',
      sessionId: row.session_id || undefined,
    }
  }

  /**
   * Search marketplace (hardcoded for now)
   */
  async searchMarketplace(query?: string): Promise<Agent[]> {
    // Hardcoded marketplace agents
    const marketplace: Agent[] = [
      {
        id: 'market_code_reviewer',
        name: 'Code Reviewer',
        roleType: 'specialist',
        deployment: 'server',
        description: 'Reviews code for bugs, style issues, performance, and security vulnerabilities.',
        specialties: ['code-review', 'security', 'best-practices'],
        status: 'active',
      },
      {
        id: 'market_tech_writer',
        name: 'Tech Writer',
        roleType: 'specialist',
        deployment: 'server',
        description: 'Writes clear technical documentation, READMEs, and API references.',
        specialties: ['documentation', 'writing', 'api-docs'],
        status: 'active',
      },
      {
        id: 'market_task_master',
        name: 'Task Master',
        roleType: 'assistant',
        deployment: 'server',
        description: 'Breaks down complex tasks into subtasks, tracks progress, and coordinates work.',
        specialties: ['project-management', 'task-planning', 'coordination'],
        status: 'active',
      },
      {
        id: 'market_researcher',
        name: 'Research Assistant',
        roleType: 'specialist',
        deployment: 'server',
        description: 'Searches the web, summarizes findings, and compiles research reports.',
        specialties: ['research', 'summarization', 'web-search'],
        status: 'active',
      },
      {
        id: 'market_debugger',
        name: 'Debugger',
        roleType: 'specialist',
        deployment: 'server',
        description: 'Expert at diagnosing and fixing bugs across multiple languages and frameworks.',
        specialties: ['debugging', 'troubleshooting', 'fixes'],
        status: 'active',
      },
    ]

    if (!query) return marketplace

    const q = query.toLowerCase()
    return marketplace.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.description?.toLowerCase().includes(q) ||
      a.specialties?.some(s => s.toLowerCase().includes(q))
    )
  }

  /**
   * Get featured marketplace agents
   */
  async getFeaturedAgents(): Promise<Agent[]> {
    return this.searchMarketplace()
  }
}

export const agentService = new AgentService()
