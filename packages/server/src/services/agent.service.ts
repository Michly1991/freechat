import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { spawn } from 'child_process'
import { join } from 'path'
import { config } from '../config.js'
import { aiConfigService } from './ai-config.service.js'
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

  /**
   * Spawn an agent to process a message.
   * Tries configured AI provider first, falls back to Claude Code CLI.
   * Returns the agent's response text.
   */
  async spawnClaudeCode(
    roomId: string,
    agentId: string,
    message: string
  ): Promise<{ response: string; silent: boolean }> {
    const agent = await this.getAgent(agentId)
    const workspaceDir = join(config.workspace.root, roomId)

    // Check for existing session
    const existingSession = db.prepare(`
      SELECT session_id FROM agent_sessions
      WHERE room_id = ? AND agent_id = ?
      ORDER BY last_active_at DESC
      LIMIT 1
    `).get(roomId, agentId) as { session_id: string } | undefined

    // Try configured AI provider first (e.g., MiniMax/Aliyun Claude)
    try {
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

    // Fallback: Use Claude Code CLI
    const args: string[] = ['-p', message, '--cwd', workspaceDir]

    // Resume existing session if available
    if (existingSession) {
      args.push('--resume', existingSession.session_id)
    }

    return new Promise((resolve, reject) => {
      const proc = spawn('claude', args, {
        cwd: workspaceDir,
        env: { ...process.env },
        timeout: 120_000, // 2 min timeout
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        const response = stdout.trim()

        // Check for [SILENT] marker — agent chose not to reply
        if (response === '[SILENT]' || response.includes('[SILENT]')) {
          this.updateSession(roomId, agentId, existingSession?.session_id)
          resolve({ response: '', silent: true })
          return
        }

        // Extract session ID from output if present (claude outputs session info)
        const sessionMatch = response.match(/session[_-]?id[:\s]+([^\s]+)/i)
        const newSessionId = sessionMatch?.[1] || existingSession?.session_id || uuidv4()

        this.updateSession(roomId, agentId, newSessionId)

        if (code !== 0 && !response) {
          reject({
            code: 'AGENT_EXECUTION_ERROR',
            message: `Claude Code exited with code ${code}: ${stderr}`
          })
          return
        }

        resolve({ response: response || '', silent: false })
      })

      proc.on('error', (err) => {
        reject({
          code: 'AGENT_SPAWN_ERROR',
          message: `Failed to spawn Claude Code: ${err.message}`
        })
      })
    })
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
