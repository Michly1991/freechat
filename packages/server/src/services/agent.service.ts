import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import { config } from '../config.js'
import bcrypt from 'bcryptjs'
import type { AgentRunContext } from './agent-run-context.js'
import { searchMarketplaceAgents } from './agent-marketplace.js'
import type { Agent, AgentRuntimeConfig, AgentToolPermissions, RoomAgentRole } from '@freechat/shared'
import { DEFAULT_AGENT_TOOLS } from '@freechat/shared'
import { mergeAgentConfig, rowToAgent, type AgentRow } from './agent-mapper.js'
import { agentPackageService } from './agent-package.service.js'
import { agentCapabilityService } from './agent-capability.service.js'
import { templatePermissionService } from './template-permission.service.js'
import { remoteAgentConnectorService } from './remote-agent-connector.service.js'
import { XIAOMI_AGENT_BUILT_IN_KEY } from './built-in-agent-constants.js'
import { AgentWorkspaceService } from './agent-workspace.service.js'
import { agentModelConfigService } from './agent-model-config.service.js'

export interface AgentConfig {
  name: string
  roleType: 'assistant' | 'specialist'
  deployment: 'server' | 'client'
  description?: string
  specialties?: string[]
  config?: AgentRuntimeConfig
  status?: 'active' | 'inactive' | 'working' | 'error'
  marketListed?: boolean
}

export interface AgentCreateResult {
  agent: Agent
  apiKey: string // Only returned once at creation
}

export interface AddAgentToRoomOptions {
  roomRole?: RoomAgentRole
  autoEnabled?: boolean
  priority?: number
  confirmedPurchase?: boolean
}

function buildAgentRunInput(agent: Agent, message: string): string {
  const details = [
    `- 名称: ${agent.name}`,
    `- ID: ${agent.id}`,
    `- 类型: ${agent.roleType}`,
    agent.description ? `- 描述: ${agent.description}` : '',
    agent.specialties?.length ? `- 专长: ${agent.specialties.join('、')}` : '',
  ].filter(Boolean).join('\n')
  return [
    `## 当前 Agent 身份\n${details}`,
    agent.config?.systemPrompt ? `## Agent System Prompt\n${agent.config.systemPrompt}` : '',
    `## 本次输入\n${message}`,
  ].filter(Boolean).join('\n\n')
}

export class AgentService extends AgentWorkspaceService {
  async createAgent(ownerId: string, cfg: AgentConfig): Promise<AgentCreateResult> {
    const id = `agent_${uuidv4()}`
    const now = Date.now()

    // Generate API key
    const apiKey = `fc_${crypto.randomBytes(32).toString('hex')}`
    const apiKeyHash = await bcrypt.hash(apiKey, 10)

    const mergedConfig = mergeAgentConfig(cfg.roleType, cfg.config)

    db.prepare(`
      INSERT INTO agents (id, owner_id, name, role_type, deployment, description, specialties, config, api_key_hash, status, is_template, template_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, 1, ?, ?)
    `).run(
      id,
      ownerId,
      cfg.name,
      cfg.roleType,
      'client',
      cfg.description || null,
      cfg.specialties ? JSON.stringify(cfg.specialties) : null,
      JSON.stringify(mergedConfig),
      apiKeyHash,
      now,
      now
    )

    const agent = rowToAgent(db.prepare(`SELECT a.*, COALESCE(u.nickname, u.username) owner_name FROM agents a LEFT JOIN users u ON u.id = a.owner_id WHERE a.id = ?`).get(id) as AgentRow)
    await agentPackageService.ensureAgentPackage(agent).catch((err) => console.error('[agent-package] ensure failed after create', err))
    return { agent, apiKey }
  }

  async updateRoomAgentModelConfig(roomId: string, agentId: string, input: any, configuredBy?: string): Promise<Agent> {
    const row = db.prepare('SELECT 1 FROM room_agents WHERE room_id = ? AND agent_id = ?').get(roomId, agentId)
    if (!row) throw { code: 'AGENT_NOT_FOUND', message: 'Agent is not in this room' }
    agentModelConfigService.updateRoomOverride(roomId, agentId, input, configuredBy)
    const agents = await this.getRoomAgents(roomId)
    const agent = agents.find((item) => item.id === agentId)
    if (!agent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    return agent
  }

  async updateAgentDefaultModelConfig(agentId: string, input: any, configuredBy: string): Promise<Agent> {
    agentModelConfigService.updateAgentDefault(agentId, input, configuredBy)
    return this.getAgent(agentId)
  }

  async getAgent(agentId: string): Promise<Agent> {
    const row = db.prepare(`
      SELECT a.*, COALESCE(u.nickname, u.username) owner_name,
        CASE WHEN amd.agent_id IS NULL THEN NULL ELSE json_object('modelProfileId', amd.model_profile_id, 'model', amd.model, 'runtime', amd.runtime, 'maxTokens', amd.max_tokens, 'temperature', amd.temperature, 'scope', 'agent_default', 'inheritedFromAgent', 1, 'allowPaidSharedModel', amd.allow_paid_shared_model) END as default_model_config,
        dmp.name as default_model_profile_name,
        dmp.owner_id as default_model_profile_owner_id,
        COALESCE(dmu.nickname, dmu.username) as default_model_profile_owner_name,
        CASE WHEN amd.model_profile_id IS NULL THEN NULL WHEN dmp.owner_id = a.owner_id THEN 'user_owned' WHEN dmp.visibility = 'platform' THEN 'platform' ELSE 'marketplace' END as default_model_source
      FROM agents a
      LEFT JOIN users u ON u.id = a.owner_id
      LEFT JOIN agent_model_defaults amd ON amd.agent_id = a.id
      LEFT JOIN model_profiles dmp ON dmp.id = amd.model_profile_id
      LEFT JOIN users dmu ON dmu.id = dmp.owner_id
      WHERE a.id = ?
    `).get(agentId) as AgentRow | undefined
    if (!row) {
      throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    }
    return rowToAgent(row)
  }

  async getUserAgents(ownerId: string): Promise<Agent[]> {
    const rows = db.prepare(`
      SELECT agents.*, COALESCE(u.nickname, u.username) owner_name,
        CASE WHEN amd.agent_id IS NULL THEN NULL ELSE json_object('modelProfileId', amd.model_profile_id, 'model', amd.model, 'runtime', amd.runtime, 'maxTokens', amd.max_tokens, 'temperature', amd.temperature, 'scope', 'agent_default', 'inheritedFromAgent', 1, 'allowPaidSharedModel', amd.allow_paid_shared_model) END as default_model_config,
        dmp.name as default_model_profile_name,
        dmp.owner_id as default_model_profile_owner_id,
        COALESCE(dmu.nickname, dmu.username) as default_model_profile_owner_name,
        CASE WHEN amd.model_profile_id IS NULL THEN NULL WHEN dmp.owner_id = ? THEN 'user_owned' WHEN dmp.visibility = 'platform' THEN 'platform' ELSE 'marketplace' END as default_model_source
      FROM agents
      LEFT JOIN users u ON u.id = agents.owner_id
      LEFT JOIN agent_model_defaults amd ON amd.agent_id = agents.id
      LEFT JOIN model_profiles dmp ON dmp.id = amd.model_profile_id
      LEFT JOIN users dmu ON dmu.id = dmp.owner_id
      WHERE COALESCE(is_template, 1) = 1
        AND (config IS NULL OR config NOT LIKE '%"defaultRoomAssistant":true%')
        AND (
          agents.owner_id = ?
          OR config LIKE '%"builtInKey":"xiaomi_assistant"%'
          OR COALESCE(agents.market_listed, 0) = 1
          OR EXISTS (SELECT 1 FROM market_follows mf WHERE mf.user_id = ? AND mf.target_type = 'agent' AND mf.target_id = agents.id)
        )
      ORDER BY
        CASE
          WHEN config LIKE '%"builtInKey":"default_assistant"%' THEN 0
          WHEN config LIKE '%"builtInKey":"xiaomi_assistant"%' THEN 1
          ELSE 2
        END ASC,
        created_at DESC
    `).all(ownerId, ownerId, ownerId) as AgentRow[]
    return rows.map(r => rowToAgent(r))
  }

  async getAvailableAgentsForRoom(roomId: string, requesterAgentId: string): Promise<Agent[]> {
    const requester = db.prepare('SELECT id FROM agents WHERE id = ?').get(requesterAgentId) as any
    if (!requester) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    const rows = db.prepare(`
      SELECT a.*, COALESCE(u.nickname, u.username) owner_name FROM agents a
      LEFT JOIN users u ON u.id = a.owner_id
      WHERE a.status != 'inactive'
        AND COALESCE(a.is_template, 1) = 1
        AND (a.config IS NULL OR a.config NOT LIKE '%"defaultRoomAssistant":true%')
        AND NOT EXISTS (
          SELECT 1
          FROM room_agents ra
          INNER JOIN agents existing ON existing.id = ra.agent_id
          WHERE ra.room_id = ?
            AND (existing.id = a.id OR existing.source_template_id = a.id)
        )
      ORDER BY
        CASE
          WHEN a.config LIKE '%"builtInKey":"default_assistant"%' THEN 0
          WHEN a.config LIKE '%"builtInKey":"xiaomi_assistant"%' THEN 1
          ELSE 2
        END ASC,
        a.created_at DESC
    `).all(roomId) as AgentRow[]
    return rows.map(r => rowToAgent(r))
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

  async cloneAgentTemplate(templateId: string, ownerId: string, overrides: { name?: string; roomId?: string } = {}): Promise<Agent> {
    const template = db.prepare(`SELECT a.*, COALESCE(u.nickname, u.username) owner_name FROM agents a LEFT JOIN users u ON u.id = a.owner_id WHERE a.id = ? AND a.status != ?`).get(templateId, 'inactive') as AgentRow | undefined
    if (!template) throw { code: 'AGENT_NOT_FOUND', message: 'Agent template not found' }

    const id = `agent_${uuidv4()}`
    const now = Date.now()
    const apiKey = `fc_${crypto.randomBytes(32).toString('hex')}`
    const apiKeyHash = await bcrypt.hash(apiKey, 10)
    const configObj = template.config ? JSON.parse(template.config) : undefined
    const clonedConfig = { ...(configObj || {}), ...(overrides.roomId ? { roomId: overrides.roomId } : {}) }

    db.prepare(`
      INSERT INTO agents (id, owner_id, name, role_type, deployment, description, specialties, config, api_key_hash, status, is_template, template_version, source_template_id, source_template_version, is_modified, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 1, ?, ?, 0, ?, ?)
    `).run(
      id,
      ownerId,
      overrides.name || template.name,
      template.role_type,
      'client',
      template.description,
      template.specialties,
      JSON.stringify(clonedConfig),
      apiKeyHash,
      template.id,
      template.template_version || 1,
      now,
      now
    )
    agentCapabilityService.cloneCapabilities(template.id, id)
    return rowToAgent(db.prepare(`SELECT a.*, COALESCE(u.nickname, u.username) owner_name FROM agents a LEFT JOIN users u ON u.id = a.owner_id WHERE a.id = ?`).get(id) as AgentRow)
  }

  isLockedBuiltInAgent(agentId: string): boolean {
    const row = db.prepare('SELECT config FROM agents WHERE id = ?').get(agentId) as { config?: string } | undefined
    if (!row) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    const config = row.config ? JSON.parse(row.config) : {}
    return !!config.locked || !!config.builtInKey
  }

  private isBuiltInDefaultAssistantConfig(config: any): boolean {
    return !!config?.defaultRoomAssistant || config?.builtInKey === 'default_assistant'
  }

  private isBuiltInDefaultAssistant(agent: Agent): boolean {
    return this.isBuiltInDefaultAssistantConfig(agent.config || {})
  }

  private roomHasAssistant(roomId: string): boolean {
    const row = db.prepare(`
      SELECT 1 FROM room_agents ra
      INNER JOIN agents a ON a.id = ra.agent_id
      WHERE ra.room_id = ? AND ra.room_role = 'assistant' AND ra.auto_enabled = 1 AND a.status != 'inactive'
      LIMIT 1
    `).get(roomId)
    return !!row
  }

  assertAgentMutable(agentId: string): void {
    if (this.isLockedBuiltInAgent(agentId)) {
      throw { code: 'BUILT_IN_AGENT_LOCKED', message: '系统内置 Agent 不可编辑或删除' }
    }
  }

  async updateAgent(agentId: string, updates: Partial<AgentConfig>): Promise<Agent> {
    const mutableKeys = Object.keys(updates).filter((key) => key !== 'status')
    if (mutableKeys.length > 0) this.assertAgentMutable(agentId)
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
      values.push('client')
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
    if (updates.marketListed !== undefined) {
      fields.push('market_listed = ?')
      values.push(updates.marketListed ? 1 : 0)
    }

    if (fields.length === 0) {
      return this.getAgent(agentId)
    }

    fields.push('updated_at = ?')
    values.push(Date.now())
    values.push(agentId)

    db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    db.prepare('UPDATE agents SET is_modified = 1 WHERE id = ? AND COALESCE(is_template, 1) = 0').run(agentId)
    const agent = await this.getAgent(agentId)
    await agentPackageService.ensureAgentPackage(agent).catch((err) => console.error('[agent-package] ensure failed after update', err))
    return agent
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.assertAgentMutable(agentId)
    db.prepare('DELETE FROM agents WHERE id = ?').run(agentId)
  }

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
    const rows = db.prepare(`SELECT a.*, COALESCE(u.nickname, u.username) owner_name FROM agents a LEFT JOIN users u ON u.id = a.owner_id WHERE a.api_key_hash IS NOT NULL`).all() as AgentRow[]
    for (const row of rows) {
      const valid = await bcrypt.compare(apiKey, row.api_key_hash!)
      if (valid) {
        return rowToAgent(row)
      }
    }
    return null
  }


  private getManagedEquivalentAgent(agent: Agent): Agent | null {
    const row = db.prepare(`
      SELECT a.*, COALESCE(u.nickname, u.username) owner_name
      FROM agents a
      INNER JOIN agent_connectors c ON c.agent_id = a.id AND c.status != 'revoked'
      LEFT JOIN users u ON u.id = a.owner_id
      WHERE a.owner_id = ? AND a.name = ? AND a.role_type = ?
      ORDER BY COALESCE(c.last_seen_at, c.created_at) DESC, a.updated_at DESC
      LIMIT 1
    `).get(agent.ownerId, agent.name, agent.roleType) as AgentRow | undefined
    return row ? rowToAgent(row) : null
  }

  private isManagedClientAgent(agentId: string): boolean {
    const row = db.prepare("SELECT 1 FROM agent_connectors WHERE agent_id = ? AND status != 'revoked' LIMIT 1").get(agentId) as any
    return !!row
  }

  /**
   * Add an agent to a room
   */
  async addAgentToRoom(roomId: string, agentId: string, addedBy: string, options: AddAgentToRoomOptions = {}): Promise<void> {
    const now = Date.now()
    let agent = await this.getAgent(agentId)
    if (this.isBuiltInDefaultAssistant(agent) && this.roomHasAssistant(roomId)) {
      return
    }
    const roomRow = db.prepare('SELECT workgroup_id FROM rooms WHERE id = ?').get(roomId) as any
    const inRoomWorkgroup = roomRow?.workgroup_id
      ? !!db.prepare('SELECT 1 FROM workgroup_agents WHERE workgroup_id = ? AND agent_id = ? AND enabled = 1').get(roomRow.workgroup_id, agentId)
      : false
    if (!inRoomWorkgroup && !(await this.canUseAgent(agentId, addedBy))) throw { code: 'AGENT_NOT_FOLLOWED', message: '请先关注或选择自己创建的 Agent' }
    const managedEquivalent = this.getManagedEquivalentAgent(agent)
    if (managedEquivalent) agent = managedEquivalent
    let targetAgentId = agent.id
    if (agent.isTemplate && !this.isManagedClientAgent(agent.id) && agent.config?.builtInKey !== XIAOMI_AGENT_BUILT_IN_KEY) {
      agent = await this.cloneAgentTemplate(agent.id, addedBy, { roomId })
      targetAgentId = agent.id
    }
    const roomRowForRole = db.prepare('SELECT room_kind, direct_target_type, direct_target_id FROM rooms WHERE id = ?').get(roomId) as any
    const isXiaomiDirectRoom = agent.config?.builtInKey === XIAOMI_AGENT_BUILT_IN_KEY && roomRowForRole?.room_kind === 'direct_agent' && roomRowForRole?.direct_target_type === 'agent' && roomRowForRole?.direct_target_id === targetAgentId
    const hasAssistant = isXiaomiDirectRoom ? false : this.roomHasAssistant(roomId)
    const requestedRole = options.roomRole || (!hasAssistant ? 'assistant' : 'specialist')
    const roomRole = this.isBuiltInDefaultAssistant(agent) && hasAssistant ? 'specialist' : requestedRole
    const autoEnabled = roomRole === 'assistant' ? true : options.autoEnabled === true

    const tx = db.transaction(() => {
      if (roomRole === 'assistant') {
        const defaultAssistantRows = db.prepare(`
          SELECT a.id FROM agents a
          INNER JOIN room_agents ra ON a.id = ra.agent_id
          WHERE ra.room_id = ? AND a.role_type = 'assistant' AND a.config LIKE ?
        `).all(roomId, '%"defaultRoomAssistant":true%') as any[]
        for (const row of defaultAssistantRows) {
          db.prepare('DELETE FROM room_agents WHERE room_id = ? AND agent_id = ?').run(roomId, row.id)
          db.prepare('DELETE FROM agents WHERE id = ?').run(row.id)
        }
        db.prepare(`
          UPDATE room_agents
          SET auto_enabled = 0, room_role = 'specialist'
          WHERE room_id = ?
            AND agent_id IN (SELECT id FROM agents WHERE role_type = 'assistant')
        `).run(roomId)
      } else if (autoEnabled) {
        db.prepare('UPDATE room_agents SET auto_enabled = 0 WHERE room_id = ?').run(roomId)
      }
      db.prepare(`
        INSERT OR REPLACE INTO room_agents (room_id, agent_id, added_by, added_at, room_role, auto_enabled, priority)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(roomId, targetAgentId, addedBy, now, roomRole, autoEnabled ? 1 : 0, options.priority || 0)
    })
    tx()

    const workgroupId = (db.prepare('SELECT workgroup_id FROM rooms WHERE id = ?').get(roomId) as any)?.workgroup_id
    if (workgroupId) {
      db.prepare('INSERT OR IGNORE INTO workgroup_agents (workgroup_id, agent_id, role, enabled, added_at) VALUES (?, ?, ?, 1, ?)')
        .run(workgroupId, targetAgentId, 'member', now)
    }

    // Don't add to room_members since agents are not in users table
    // Agent membership is tracked via room_agents table
  }

  async canEditAgent(agentId: string, user: { id: string; role?: string }): Promise<boolean> {
    if (this.isLockedBuiltInAgent(agentId)) return false
    return templatePermissionService.canEdit('agent', agentId, user)
  }

  async assertAgentOwner(agentId: string, userId: string, userRole?: string): Promise<void> {
    this.assertAgentMutable(agentId)
    const ok = await this.canEditAgent(agentId, { id: userId, role: userRole })
    if (!ok) throw { code: 'FORBIDDEN', message: 'Only the Agent owner/admin can edit this Agent' }
  }

  async canUseAgent(agentId: string, userId: string): Promise<boolean> {
    const row = db.prepare('SELECT owner_id, is_template, status, config FROM agents WHERE id = ?').get(agentId) as any
    if (!row || row.status === 'inactive') return false
    if (row.owner_id === userId) return true
    if (String(row.config || '').includes('"builtInKey":"default_assistant"')) return true
    if (String(row.config || '').includes(`"builtInKey":"${XIAOMI_AGENT_BUILT_IN_KEY}"`)) return true
    if (!row.is_template || String(row.config || '').includes('"defaultRoomAssistant":true')) return false
    return !!db.prepare('SELECT 1 FROM market_follows WHERE user_id = ? AND target_type = ? AND target_id = ?').get(userId, 'agent', agentId)
  }

  async canEditRoomAgents(roomId: string, userId: string): Promise<boolean> {
    const row = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId) as any
    return row?.role === 'owner' || row?.role === 'editor'
  }

  async getAutoAgent(roomId: string): Promise<Agent | null> {
    const select = `
      SELECT a.*, COALESCE(u.nickname, u.username) owner_name, ra.room_role, ra.auto_enabled, ra.priority as room_priority,
        CASE WHEN b.room_id IS NULL THEN NULL ELSE json_object('modelProfileId', b.model_profile_id, 'model', b.model, 'runtime', b.runtime, 'maxTokens', b.max_tokens, 'temperature', b.temperature, 'scope', 'room_override', 'inheritedFromAgent', 0) END as room_model_config,
        mp.name as room_model_profile_name,
        mp.owner_id as room_model_profile_owner_id,
        COALESCE(mu.nickname, mu.username) as room_model_profile_owner_name,
        CASE WHEN b.model_profile_id IS NULL THEN NULL WHEN mp.owner_id = r.created_by THEN 'user_owned' WHEN mp.visibility = 'platform' THEN 'platform' ELSE 'marketplace' END as room_model_source,
        CASE WHEN amd.agent_id IS NULL THEN NULL ELSE json_object('modelProfileId', amd.model_profile_id, 'model', amd.model, 'runtime', amd.runtime, 'maxTokens', amd.max_tokens, 'temperature', amd.temperature, 'scope', 'agent_default', 'inheritedFromAgent', 1, 'allowPaidSharedModel', amd.allow_paid_shared_model) END as default_model_config,
        dmp.name as default_model_profile_name,
        dmp.owner_id as default_model_profile_owner_id,
        COALESCE(dmu.nickname, dmu.username) as default_model_profile_owner_name,
        CASE WHEN amd.model_profile_id IS NULL THEN NULL WHEN dmp.owner_id = r.created_by THEN 'user_owned' WHEN dmp.visibility = 'platform' THEN 'platform' ELSE 'marketplace' END as default_model_source,
        (SELECT MAX(last_active_at) FROM agent_sessions s WHERE s.room_id = ra.room_id AND s.agent_id = a.id) as agent_last_active_at
      FROM agents a INNER JOIN room_agents ra ON a.id = ra.agent_id
      INNER JOIN rooms r ON r.id = ra.room_id
      LEFT JOIN users u ON u.id = a.owner_id
      LEFT JOIN room_agent_model_bindings b ON b.room_id = ra.room_id AND b.agent_id = ra.agent_id
      LEFT JOIN model_profiles mp ON mp.id = b.model_profile_id
      LEFT JOIN users mu ON mu.id = mp.owner_id
      LEFT JOIN agent_model_defaults amd ON amd.agent_id = a.id
      LEFT JOIN model_profiles dmp ON dmp.id = amd.model_profile_id
      LEFT JOIN users dmu ON dmu.id = dmp.owner_id`
    const current = db.prepare(`${select} WHERE ra.room_id = ? AND r.current_assistant_agent_id = a.id AND a.status != 'inactive' LIMIT 1`).get(roomId) as AgentRow | undefined
    const fallback = current || db.prepare(`${select} WHERE ra.room_id = ? AND ra.auto_enabled = 1 AND a.status != 'inactive' ORDER BY ra.priority ASC, ra.added_at ASC LIMIT 1`).get(roomId) as AgentRow | undefined
    return fallback ? rowToAgent(fallback) : null
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
    const cutoff = Date.now() - ((config.agent.hardTimeoutMs || config.agent.taskTimeoutMs || 120000) + (config.agent.killGraceMs || 3000) + 30000)
    const runningRows = db.prepare(`
      SELECT DISTINCT room_id, agent_id
      FROM agent_runs
      WHERE status = 'running' AND started_at < ? ${roomId ? 'AND room_id = ?' : ''}
    `).all(...(roomId ? [cutoff, roomId] : [cutoff])) as any[]
    if (runningRows.length === 0) return
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE agent_runs
        SET status = CASE WHEN task_id IS NOT NULL OR subtask_id IS NOT NULL THEN 'interrupted' ELSE 'failed' END,
            error = COALESCE(error, CASE WHEN task_id IS NOT NULL OR subtask_id IS NOT NULL THEN 'Interrupted: run exceeded timeout without completion' ELSE 'Marked stale: run exceeded timeout without completion' END),
            finished_at = COALESCE(finished_at, ?)
        WHERE status = 'running' AND started_at < ? ${roomId ? 'AND room_id = ?' : ''}
      `).run(...(roomId ? [Date.now(), cutoff, roomId] : [Date.now(), cutoff]))
      for (const row of runningRows) {
        const activeRun = db.prepare('SELECT id FROM agent_runs WHERE agent_id = ? AND status = ? LIMIT 1').get(row.agent_id, 'running') as any
        if (!activeRun) db.prepare("UPDATE agents SET status = 'active', updated_at = ? WHERE id = ? AND status = 'working'").run(Date.now(), row.agent_id)
      }
    })
    tx()
  }

  async recoverInterruptedTaskRuns(roomId?: string): Promise<void> {
    const rows = db.prepare(`
      SELECT id, room_id, agent_id, input, actor_user_id, task_id, subtask_id, resume_attempt
      FROM agent_runs
      WHERE status = 'interrupted' AND (task_id IS NOT NULL OR subtask_id IS NOT NULL)
        AND COALESCE(resume_attempt, 0) < 2 ${roomId ? 'AND room_id = ?' : ''}
      ORDER BY started_at ASC
      LIMIT 20
    `).all(...(roomId ? [roomId] : [])) as any[]
    for (const row of rows) {
      const task = row.task_id ? db.prepare("SELECT id, title, status FROM tasks WHERE id = ? AND status NOT IN ('done','cancelled')").get(row.task_id) as any : null
      if (row.task_id && !task) continue
      const item = row.subtask_id ? db.prepare("SELECT id, task_id, title, status FROM task_items WHERE id = ? AND status NOT IN ('done','cancelled')").get(row.subtask_id) as any : null
      if (row.subtask_id && !item) continue
      const prompt = ['你上次处理任务时运行中断了，请恢复处理，不要重新创建父任务。', task ? `父任务ID: ${task.id}` : '', task ? `父任务标题: ${task.title}` : '', item ? `子任务ID: ${item.id}` : '', item ? `子任务标题: ${item.title}` : '', '', '必须先执行 ./freechat task list 查看当前房间已有任务；如果有子任务ID，还要执行 ./freechat task subtask list <父任务ID>。之后基于已有任务继续推进，用 progress/update 写进展。'].filter(Boolean).join('\n')
      db.prepare("UPDATE agent_runs SET status = 'resumed', error = COALESCE(error, 'Queued for automatic resume') WHERE id = ?").run(row.id)
      db.prepare("UPDATE agents SET status = 'working', updated_at = ? WHERE id = ?").run(Date.now(), row.agent_id)
      void this.enqueueAgentRun(row.room_id, row.agent_id, prompt, { actorUserId: row.actor_user_id || undefined, runSource: 'resume', taskId: row.task_id || item?.task_id, subtaskId: row.subtask_id || undefined, parentRunId: row.id, resumeAttempt: Number(row.resume_attempt || 0) + 1 }).then(() => {
        db.prepare("UPDATE agents SET status = 'active', updated_at = ? WHERE id = ? AND status = 'working'").run(Date.now(), row.agent_id)
      }).catch((err) => {
        db.prepare("UPDATE agent_runs SET status = 'failed', error = COALESCE(error, ?), finished_at = COALESCE(finished_at, ?) WHERE id = ?").run(err?.message || String(err), Date.now(), row.id)
        db.prepare("UPDATE agents SET status = 'error', updated_at = ? WHERE id = ?").run(Date.now(), row.agent_id)
      })
    }
  }

  async getRoomAgents(roomId: string): Promise<Agent[]> {
    this.recoverStaleRuns(roomId)
    const rows = db.prepare(`
      SELECT a.*, COALESCE(u.nickname, u.username) owner_name, ra.room_role, ra.auto_enabled, ra.priority as room_priority,
        CASE WHEN b.room_id IS NULL THEN NULL ELSE json_object(
          'modelProfileId', b.model_profile_id,
          'model', b.model,
          'runtime', b.runtime,
          'maxTokens', b.max_tokens,
          'temperature', b.temperature,
          'scope', 'room_override',
          'inheritedFromAgent', 0
        ) END as room_model_config,
        mp.name as room_model_profile_name,
        mp.owner_id as room_model_profile_owner_id,
        COALESCE(mu.nickname, mu.username) as room_model_profile_owner_name,
        CASE WHEN b.model_profile_id IS NULL THEN NULL WHEN mp.owner_id = r.created_by THEN 'user_owned' WHEN mp.visibility = 'platform' THEN 'platform' ELSE 'marketplace' END as room_model_source,
        CASE WHEN amd.agent_id IS NULL THEN NULL ELSE json_object(
          'modelProfileId', amd.model_profile_id,
          'model', amd.model,
          'runtime', amd.runtime,
          'maxTokens', amd.max_tokens,
          'temperature', amd.temperature,
          'scope', 'agent_default',
          'inheritedFromAgent', 1,
          'allowPaidSharedModel', amd.allow_paid_shared_model
        ) END as default_model_config,
        dmp.name as default_model_profile_name,
        dmp.owner_id as default_model_profile_owner_id,
        COALESCE(dmu.nickname, dmu.username) as default_model_profile_owner_name,
        CASE WHEN amd.model_profile_id IS NULL THEN NULL WHEN dmp.owner_id = r.created_by THEN 'user_owned' WHEN dmp.visibility = 'platform' THEN 'platform' ELSE 'marketplace' END as default_model_source,
        (
        SELECT MAX(last_active_at)
        FROM agent_sessions s
        WHERE s.room_id = ra.room_id AND s.agent_id = a.id
      ) as agent_last_active_at
      FROM agents a
      INNER JOIN room_agents ra ON a.id = ra.agent_id
      INNER JOIN rooms r ON r.id = ra.room_id
      LEFT JOIN users u ON u.id = a.owner_id
      LEFT JOIN room_agent_model_bindings b ON b.room_id = ra.room_id AND b.agent_id = ra.agent_id
      LEFT JOIN model_profiles mp ON mp.id = b.model_profile_id
      LEFT JOIN users mu ON mu.id = mp.owner_id
      LEFT JOIN agent_model_defaults amd ON amd.agent_id = a.id
      LEFT JOIN model_profiles dmp ON dmp.id = amd.model_profile_id
      LEFT JOIN users dmu ON dmu.id = dmp.owner_id
      WHERE ra.room_id = ?
      ORDER BY ra.auto_enabled DESC, ra.priority ASC, ra.added_at ASC
    `).all(roomId) as AgentRow[]
    const agents = rows.map(r => {
      const agent = rowToAgent(r)
      if (agent.deployment !== 'client') return agent
      const summary = remoteAgentConnectorService.getConnectorSummary(agent.id)
      return { ...agent, ...summary, onlineStatus: summary.clientConnectorStatus === 'working' ? 'working' : summary.clientConnectorStatus === 'online' ? 'online' : 'offline' } as any
    })
    const hasPrimaryAssistant = agents.some((agent) => agent.roomRole === 'assistant' && agent.autoEnabled)
    return hasPrimaryAssistant
      ? agents.filter((agent) => !(this.isBuiltInDefaultAssistant(agent) && agent.roomRole !== 'assistant'))
      : agents
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



  forceStopAgentRuntime(roomId: string, agentId: string, reason?: string) {
    return null
  }

  getActiveAgentRuntime(roomId: string, agentId: string) {
    return null
  }

  async enqueueAgentRun(roomId: string, agentId: string, message: string, options: { timeoutMs?: number; actorUserId?: string; onEvent?: (event: any) => void } & AgentRunContext = {}): Promise<{ response: string; silent: boolean }> {
    const agent = await this.getAgent(agentId)
    remoteAgentConnectorService.enqueueRun(roomId, agentId, buildAgentRunInput(agent, message), options)
    return { response: '', silent: true }
  }


  async searchMarketplace(query?: string): Promise<Agent[]> {
    return searchMarketplaceAgents(query)
  }

  async getFeaturedAgents(): Promise<Agent[]> {
    return this.searchMarketplace()
  }
}

export const agentService = new AgentService()
