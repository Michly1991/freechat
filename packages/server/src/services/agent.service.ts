import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { spawn } from 'child_process'
import { chmod, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { config } from '../config.js'
import { aiConfigService } from './ai-config.service.js'
import { createAgentToolToken } from '../agent-tool-token.js'
import { renderAgentCli } from './agent-cli-template.js'
import { renderAgentApiDoc, renderAgentGuide } from './agent-workspace-template.js'
import type { Agent, AgentRuntimeConfig, AgentToolPermissions, RoomAgentRole } from '@freechat/shared'
import { DEFAULT_ASSISTANT_AGENT_CONFIG, DEFAULT_SPECIALIST_AGENT_CONFIG, DEFAULT_AGENT_TOOLS } from '@freechat/shared'

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
  agent_last_active_at?: number | null
  room_role?: string | null
  auto_enabled?: number | null
  room_priority?: number | null
}

export interface AgentConfig {
  name: string
  roleType: 'assistant' | 'specialist'
  deployment: 'server' | 'client'
  description?: string
  specialties?: string[]
  config?: AgentRuntimeConfig
  status?: 'active' | 'inactive' | 'working' | 'error'
}

export interface AgentCreateResult {
  agent: Agent
  apiKey: string // Only returned once at creation
}

export interface AddAgentToRoomOptions {
  roomRole?: RoomAgentRole
  autoEnabled?: boolean
  priority?: number
}

function mergeAgentConfig(roleType: 'assistant' | 'specialist', config?: AgentRuntimeConfig): AgentRuntimeConfig {
  const base = roleType === 'assistant' ? DEFAULT_ASSISTANT_AGENT_CONFIG : DEFAULT_SPECIALIST_AGENT_CONFIG
  return {
    ...base,
    ...(config || {}),
    behavior: { ...(base.behavior || {}), ...(config?.behavior || {}) },
    tools: { ...(base.tools || {}), ...(config?.tools || {}) },
    model: { ...(base.model || {}), ...(config?.model || {}) },
  }
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

    const mergedConfig = mergeAgentConfig(cfg.roleType, cfg.config)

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
      JSON.stringify(mergedConfig),
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
    const rows = db.prepare(`
      SELECT * FROM agents
      WHERE owner_id = ?
        AND (config IS NULL OR config NOT LIKE '%"defaultRoomAssistant":true%')
      ORDER BY created_at DESC
    `).all(ownerId) as AgentRow[]
    return rows.map(r => this.rowToAgent(r))
  }

  async getAvailableAgentsForRoom(roomId: string, requesterAgentId: string): Promise<Agent[]> {
    const requester = db.prepare('SELECT owner_id FROM agents WHERE id = ?').get(requesterAgentId) as any
    if (!requester) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    const rows = db.prepare(`
      SELECT a.* FROM agents a
      WHERE a.owner_id = ?
        AND a.status != 'inactive'
        AND (a.config IS NULL OR a.config NOT LIKE '%"defaultRoomAssistant":true%')
        AND NOT EXISTS (
          SELECT 1 FROM room_agents ra WHERE ra.room_id = ? AND ra.agent_id = a.id
        )
      ORDER BY a.created_at DESC
    `).all(requester.owner_id, roomId) as AgentRow[]
    return rows.map(r => this.rowToAgent(r))
  }

  async assertRoomAssistant(roomId: string, agentId: string): Promise<void> {
    const row = db.prepare(`
      SELECT a.role_type, ra.room_role
      FROM agents a
      INNER JOIN room_agents ra ON a.id = ra.agent_id
      WHERE ra.room_id = ? AND a.id = ?
    `).get(roomId, agentId) as any
    if (!row) throw { code: 'FORBIDDEN', message: 'Agent is not in this room' }
    if (row.room_role !== 'assistant' && row.role_type !== 'assistant') {
      throw { code: 'FORBIDDEN', message: 'Only room assistant agents can add agents' }
    }
  }

  async resolveAvailableAgentForRoom(roomId: string, requesterAgentId: string, raw: string): Promise<Agent> {
    const text = String(raw || '').trim().replace(/^@/, '')
    if (!text) throw { code: 'VALIDATION_ERROR', message: 'agent name or id is required' }
    const agents = await this.getAvailableAgentsForRoom(roomId, requesterAgentId)
    const matched = agents.find((a) => a.id === text || a.name === text || a.name.includes(text) || text.includes(a.name))
    if (!matched) throw { code: 'AGENT_NOT_FOUND', message: `Available agent not found: ${text}` }
    return matched
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
  async addAgentToRoom(roomId: string, agentId: string, addedBy: string, options: AddAgentToRoomOptions = {}): Promise<void> {
    const now = Date.now()
    const agent = await this.getAgent(agentId)
    const roomRole = options.roomRole || (agent.roleType === 'assistant' ? 'assistant' : 'specialist')
    const autoEnabled = options.autoEnabled === true

    const tx = db.transaction(() => {
      if (autoEnabled) {
        db.prepare('UPDATE room_agents SET auto_enabled = 0 WHERE room_id = ?').run(roomId)
      }
      db.prepare(`
        INSERT OR REPLACE INTO room_agents (room_id, agent_id, added_by, added_at, room_role, auto_enabled, priority)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(roomId, agentId, addedBy, now, roomRole, autoEnabled ? 1 : 0, options.priority || 0)
    })
    tx()

    // Don't add to room_members since agents are not in users table
    // Agent membership is tracked via room_agents table
  }

  async assertAgentOwner(agentId: string, userId: string): Promise<void> {
    const row = db.prepare('SELECT owner_id FROM agents WHERE id = ?').get(agentId) as any
    if (!row) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    if (row.owner_id !== userId) throw { code: 'FORBIDDEN', message: 'You do not own this agent' }
  }

  async canUseAgent(agentId: string, userId: string): Promise<boolean> {
    const row = db.prepare('SELECT owner_id FROM agents WHERE id = ?').get(agentId) as any
    return !!row && row.owner_id === userId
  }

  async canEditRoomAgents(roomId: string, userId: string): Promise<boolean> {
    const row = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId) as any
    return row?.role === 'owner' || row?.role === 'editor'
  }

  async getAutoAgent(roomId: string): Promise<Agent | null> {
    const row = db.prepare(`
      SELECT a.*, ra.room_role, ra.auto_enabled, ra.priority as room_priority, (
        SELECT MAX(last_active_at)
        FROM agent_sessions s
        WHERE s.room_id = ra.room_id AND s.agent_id = a.id
      ) as agent_last_active_at
      FROM agents a
      INNER JOIN room_agents ra ON a.id = ra.agent_id
      WHERE ra.room_id = ? AND ra.auto_enabled = 1 AND a.status != 'inactive'
      ORDER BY ra.priority ASC, ra.added_at ASC
      LIMIT 1
    `).get(roomId) as AgentRow | undefined
    return row ? this.rowToAgent(row) : null
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
  recoverStaleRuns(roomId?: string): void {
    const cutoff = Date.now() - ((config.agent.timeoutMs || 120000) + (config.agent.killGraceMs || 3000) + 30000)
    const runningRows = db.prepare(`
      SELECT DISTINCT room_id, agent_id
      FROM agent_runs
      WHERE status = 'running' AND started_at < ? ${roomId ? 'AND room_id = ?' : ''}
    `).all(...(roomId ? [cutoff, roomId] : [cutoff])) as any[]
    if (runningRows.length === 0) return
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE agent_runs
        SET status = 'failed', error = COALESCE(error, 'Marked stale: run exceeded timeout without completion'), finished_at = COALESCE(finished_at, ?)
        WHERE status = 'running' AND started_at < ? ${roomId ? 'AND room_id = ?' : ''}
      `).run(...(roomId ? [Date.now(), cutoff, roomId] : [Date.now(), cutoff]))
      for (const row of runningRows) {
        const activeRun = db.prepare('SELECT id FROM agent_runs WHERE agent_id = ? AND status = ? LIMIT 1').get(row.agent_id, 'running') as any
        if (!activeRun) db.prepare("UPDATE agents SET status = 'active', updated_at = ? WHERE id = ? AND status = 'working'").run(Date.now(), row.agent_id)
      }
    })
    tx()
  }

  async getRoomAgents(roomId: string): Promise<Agent[]> {
    this.recoverStaleRuns(roomId)
    const rows = db.prepare(`
      SELECT a.*, ra.room_role, ra.auto_enabled, ra.priority as room_priority, (
        SELECT MAX(last_active_at)
        FROM agent_sessions s
        WHERE s.room_id = ra.room_id AND s.agent_id = a.id
      ) as agent_last_active_at
      FROM agents a
      INNER JOIN room_agents ra ON a.id = ra.agent_id
      WHERE ra.room_id = ?
      ORDER BY ra.auto_enabled DESC, ra.priority ASC, ra.added_at ASC
    `).all(roomId) as AgentRow[]
    return rows.map(r => this.rowToAgent(r))
  }

  assertToolAllowed(agent: Agent, action: string): void {
    const tools: AgentToolPermissions = { ...DEFAULT_AGENT_TOOLS, ...(agent.config?.tools || {}) }
    const first = action.split('.')[0]
    const domain = first === 'tab-config' ? 'file' : first === 'agent' ? 'members' : first
    const allowed = domain === 'chat' ? tools.chat
      : domain === 'task' ? tools.task
        : domain === 'file' ? tools.file
          : domain === 'tab' ? tools.tab
            : domain === 'interaction' ? tools.interaction
              : domain === 'members' || domain === 'room' ? tools.members
                : true
    if (!allowed) {
      throw { code: 'AGENT_TOOL_FORBIDDEN', message: `This agent is not allowed to use ${domain} tools` }
    }
  }

  buildAgentSystemPrompt(agent: Agent): string {
    const cfg = agent.config || {}
    const tools = { ...DEFAULT_AGENT_TOOLS, ...(cfg.tools || {}) }
    const behavior = {
      replyMode: agent.roleType === 'assistant' ? 'auto_when_relevant' : 'mention_only',
      silentAllowed: true,
      ...(cfg.behavior || {})
    }
    return [
      '你是 FreeChat 项目中的业务 Agent。',
      '',
      `【Agent 名称】${agent.name}`,
      `【Agent 类型】${agent.roleType === 'assistant' ? '业务助理' : '业务专家'}`,
      agent.description ? `【业务职责】${agent.description}` : '',
      agent.specialties?.length ? `【专长】${agent.specialties.join('、')}` : '',
      cfg.systemPrompt ? `【业务自定义提示词】\n${cfg.systemPrompt}` : '',
      '',
      `【响应模式】${behavior.replyMode}`,
      behavior.silentAllowed ? '不需要回应时必须只输出 [SILENT]。' : '',
      '',
      '【工具权限】',
      `- chat: ${tools.chat ? '允许' : '禁止'}`,
      `- task: ${tools.task ? '允许' : '禁止'}`,
      `- file: ${tools.file ? '允许' : '禁止'}`,
      `- tab: ${tools.tab ? '允许' : '禁止'}`,
      `- interaction: ${tools.interaction ? '允许' : '禁止'}`,
      `- members: ${tools.members ? '允许' : '禁止'}`,
      '',
      '【系统规则】',
      '1. 只能通过 ./freechat 操作项目，不要直接访问或修改项目共享目录。',
      '2. 需要用户决策时使用 interaction。',
      '3. 处理长期事项时使用 task/progress。',
      '3.1 需要查看房间协作者时使用 ./freechat members list；助理需要拉入已有业务 Agent 时可使用 ./freechat agent list-available 和 ./freechat agent add <名称或ID>；缺少必要专家时可用 ./freechat agent create-request 发起创建确认卡，但必须等待用户确认。',
      agent.roleType === 'assistant'
        ? '4. 你是默认入口和调度者；用户未明确 @ 专家时，只代表自己/助理响应。遇到复合任务、长内容任务、或明显命中房间专家专长的任务，必须先用 members.list 查看专家；有匹配专家时禁止自己直接产出最终成品，必须用 ./freechat task plan create-json 创建真实交互卡，或用 task/subtask --assignee 分派专家。禁止只用普通聊天文本/Markdown 表格假装任务计划。用户给出大致题材但缺少时长/受众等细节时，不要只追问；应先用合理默认假设创建计划卡，并在计划说明里写清可后续调整。'
        : '4. 专家只处理人类明确 @ 或任务分派给自己的事项；不要抢助理的入口职责。',
      '5. 不要通过普通聊天 @ 另一个 Agent 来制造自动对话；多 Agent 协作优先通过任务/子任务分派。',
      '6. 回复要简洁、面向当前项目上下文。',
      '7. Agent 完成父任务时不要让任务直接隐藏；提交完成应进入 review/待审核，等待人类确认后才算 done。',
    ].filter(Boolean).join('\n')
  }

  async buildRoomContextFiles(roomId: string, currentAgent?: Agent): Promise<{ roomMd: string; membersMd: string }> {
    const room = db.prepare('SELECT id, name, description, created_by, created_at, updated_at FROM rooms WHERE id = ?').get(roomId) as any
    const members = db.prepare(`
      SELECT rm.role, rm.joined_at, u.id, u.username, u.nickname, u.avatar,
             rp.display_name, rp.role_description, rp.custom_data
      FROM room_members rm
      INNER JOIN users u ON rm.user_id = u.id
      LEFT JOIN room_profiles rp ON rm.room_id = rp.room_id AND rm.user_id = rp.member_id
      WHERE rm.room_id = ?
      ORDER BY rm.joined_at ASC
    `).all(roomId) as any[]
    const agents = await this.getRoomAgents(roomId)

    const roomMd = `# Room Context\n\n- Room ID: ${roomId}\n- Name: ${room?.name || ''}\n- Description: ${room?.description || ''}\n${currentAgent ? `- Current Agent: ${currentAgent.name}\n- Current Agent ID: ${currentAgent.id}\n- Current Agent Role: ${currentAgent.roleType}\n` : ''}`

    const humanLines = members.map((m) => {
      const custom = m.custom_data ? (() => { try { return JSON.parse(m.custom_data) } catch { return {} } })() : {}
      const profileSpecs = Array.isArray(custom.specialties) ? custom.specialties.join('、') : ''
      return [
        `- ${m.display_name || m.nickname || m.username} (@${m.username})`,
        `  - ID: ${m.id}`,
        `  - Room Role: ${m.role}`,
        custom.roleTitle ? `  - Title: ${custom.roleTitle}` : '',
        m.role_description ? `  - Role Description: ${m.role_description}` : '',
        custom.persona ? `  - Persona: ${custom.persona}` : '',
        profileSpecs ? `  - Specialties: ${profileSpecs}` : '',
      ].filter(Boolean).join('\n')
    }).join('\n')

    const agentLines = agents.map((a) => {
      const cfg = a.config || {}
      return [
        `- ${a.name}`,
        `  - ID: ${a.id}`,
        `  - Type: ${a.roleType}`,
        `  - Room Role: ${a.roomRole || (a.roleType === 'assistant' ? 'assistant' : 'specialist')}`,
        `  - Auto Enabled: ${a.autoEnabled ? 'yes' : 'no'}`,
        `  - Status: ${a.status || 'active'}`,
        a.description ? `  - Description: ${a.description}` : '',
        a.specialties?.length ? `  - Specialties: ${a.specialties.join('、')}` : '',
        cfg.systemPrompt ? `  - Custom Prompt Summary: ${String(cfg.systemPrompt).slice(0, 300)}` : '',
      ].filter(Boolean).join('\n')
    }).join('\n')

    const membersMd = `# Members and Agents\n\n所有当前房间协作者如下。分派专家时必须使用这里的 Agent 名称或 ID，例如：\`./freechat task create "任务" "说明" --assignee "专家名称"\`。\n\n## Humans\n\n${humanLines || '- none'}\n\n## Agents\n\n${agentLines || '- none'}\n`
    return { roomMd, membersMd }
  }

  async refreshRoomAgentContext(roomId: string): Promise<void> {
    const agents = await this.getRoomAgents(roomId)
    const rootMetaDir = join(config.workspace.root, roomId, '.freechat')
    await mkdir(rootMetaDir, { recursive: true })
    const rootCtx = await this.buildRoomContextFiles(roomId)
    await writeFile(join(rootMetaDir, 'ROOM.md'), rootCtx.roomMd, 'utf8')
    await writeFile(join(rootMetaDir, 'MEMBERS.md'), rootCtx.membersMd, 'utf8')

    for (const agent of agents) {
      const metaDir = join(config.workspace.root, roomId, 'agents', agent.id, '.freechat')
      await mkdir(metaDir, { recursive: true })
      const ctx = await this.buildRoomContextFiles(roomId, agent)
      await writeFile(join(metaDir, 'ROOM.md'), ctx.roomMd, 'utf8')
      await writeFile(join(metaDir, 'MEMBERS.md'), ctx.membersMd, 'utf8')
    }
  }

  async prepareAgentWorkspace(roomId: string, agent: Agent): Promise<string> {
    const workspaceDir = join(config.workspace.root, roomId, 'agents', agent.id)
    const metaDir = join(workspaceDir, '.freechat')
    const skillsDir = join(workspaceDir, 'skills')
    const resDir = join(workspaceDir, 'res')
    const scriptsDir = join(workspaceDir, 'scripts')

    await mkdir(metaDir, { recursive: true })
    await mkdir(skillsDir, { recursive: true })
    await mkdir(resDir, { recursive: true })
    await mkdir(scriptsDir, { recursive: true })

    const toolToken = createAgentToolToken(roomId, agent.id)
    const toolApiUrl = `http://127.0.0.1:${config.port}`
    const contextFiles = await this.buildRoomContextFiles(roomId, agent)

    const cliPath = join(workspaceDir, 'freechat')
    await writeFile(cliPath, renderAgentCli({ apiUrl: toolApiUrl, roomId, token: toolToken }), 'utf8')
    await chmod(cliPath, 0o700)

    const agentGuide = renderAgentGuide(agent)

    await writeFile(join(workspaceDir, 'AGENT.md'), agentGuide, 'utf8')
    await writeFile(join(workspaceDir, 'CLAUDE.md'), `${agentGuide}\n\n启动后请先遵守本文件和 .freechat/API.md。\n`, 'utf8')

    await writeFile(join(metaDir, 'ROOM.md'), contextFiles.roomMd, 'utf8')

    await writeFile(join(metaDir, 'MEMBERS.md'), contextFiles.membersMd, 'utf8')

    await writeFile(join(metaDir, 'API.md'), renderAgentApiDoc(), 'utf8')

    return workspaceDir
  }

  /**
   * Spawn an agent to process a message.
   * Server-side agents default to Claude Code CLI with the agent private workspace as cwd.
   * Provider API is only used when AGENT_RUNTIME=provider-api.
   * Returns the agent's response text.
   */
  async spawnClaudeCode(
    roomId: string,
    agentId: string,
    message: string
  ): Promise<{ response: string; silent: boolean }> {
    const agent = await this.getAgent(agentId)
    const workspaceDir = await this.prepareAgentWorkspace(roomId, agent)
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
        const agentPrompt = this.buildAgentSystemPrompt(agent)
        
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
          message: `Claude Code timed out after ${config.agent.timeoutMs}ms. Partial output: ${combined.slice(-2000)}`
        })
      }, config.agent.timeoutMs)

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
      this.finishAgentRun(runId, 'failed', undefined, err?.message || String(err), existingSession?.session_id)
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

  private finishAgentRun(runId: string, status: 'succeeded' | 'failed' | 'cancelled', output?: string, error?: string, sessionId?: string): void {
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

  /**
   * Convert a DB row to an Agent object
   */
  private rowToAgent(row: AgentRow): Agent {
    const status = (row.status as 'active' | 'inactive' | 'working' | 'error') || 'active'
    const onlineStatus = status === 'working'
      ? 'working'
      : status === 'inactive'
        ? 'offline'
        : status === 'error'
          ? 'error'
          : 'online'

    return {
      id: row.id,
      name: row.name,
      roleType: row.role_type as 'assistant' | 'specialist',
      deployment: row.deployment as 'server' | 'client',
      description: row.description || undefined,
      specialties: row.specialties ? JSON.parse(row.specialties) : undefined,
      config: row.config ? JSON.parse(row.config) : undefined,
      status,
      onlineStatus,
      lastActiveAt: row.agent_last_active_at || undefined,
      sessionId: row.session_id || undefined,
      roomRole: (row.room_role as RoomAgentRole) || undefined,
      autoEnabled: row.auto_enabled !== undefined && row.auto_enabled !== null ? !!row.auto_enabled : undefined,
      roomPriority: row.room_priority ?? undefined,
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
