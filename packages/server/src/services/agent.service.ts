import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { chmod, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { config } from '../config.js'
import { createAgentToolToken } from '../agent-tool-token.js'
import { renderAgentCliCjs, renderAgentCliWrapper } from './agent-cli-template.js'
import { renderAgentApiDoc, renderAgentGuide } from './agent-workspace-template.js'
import type { AgentRunContext } from './agent-run-context.js'
import { searchMarketplaceAgents } from './agent-marketplace.js'
import type { Agent, AgentRuntimeConfig, AgentToolPermissions, RoomAgentModelConfig, RoomAgentRole } from '@freechat/shared'
import { DEFAULT_AGENT_TOOLS } from '@freechat/shared'
import { mergeAgentConfig, rowToAgent, type AgentRow } from './agent-mapper.js'
import { agentCapabilityService } from './agent-capability.service.js'
import { renderRoleCapabilitiesForPrompt } from './agent-role-capabilities.js'
import { templatePermissionService } from './template-permission.service.js'
import { tabFilesMapService } from './tab-files-map.service.js'
import { agentGrowthService } from './agent-growth.service.js'
import { agentPackageService } from './agent-package.service.js'
import { remoteAgentConnectorService } from './remote-agent-connector.service.js'
import { XIAOMI_AGENT_BUILT_IN_KEY } from './built-in-agent-constants.js'

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

function sanitizeRoomModelConfig(value: any): RoomAgentModelConfig | null {
  if (!value || typeof value !== 'object') return null
  const out: RoomAgentModelConfig = {}
  if (value.modelProfileId) out.modelProfileId = String(value.modelProfileId)
  if (value.model) out.model = String(value.model)
  if (value.runtime === 'claude-code') out.runtime = value.runtime
  if (value.maxTokens !== undefined) {
    const n = Number(value.maxTokens)
    if (Number.isFinite(n) && n > 0) out.maxTokens = Math.trunc(n)
  }
  if (value.temperature !== undefined) {
    const n = Number(value.temperature)
    if (Number.isFinite(n)) out.temperature = n
  }
  return Object.keys(out).length > 0 ? out : null
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

export class AgentService {
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

  async updateRoomAgentModelConfig(roomId: string, agentId: string, input: any): Promise<Agent> {
    const modelConfig = sanitizeRoomModelConfig(input)
    const row = db.prepare('SELECT 1 FROM room_agents WHERE room_id = ? AND agent_id = ?').get(roomId, agentId)
    if (!row) throw { code: 'AGENT_NOT_FOUND', message: 'Agent is not in this room' }
    if (modelConfig?.modelProfileId) {
      const profile = db.prepare('SELECT id FROM model_profiles WHERE id = ? AND enabled = 1').get(modelConfig.modelProfileId)
      if (!profile) throw { code: 'MODEL_PROFILE_NOT_FOUND', message: 'Model profile not found or disabled' }
    }
    const now = Date.now()
    const tx = db.transaction(() => {
      if (modelConfig) {
        const extra = { maxTokens: modelConfig.maxTokens, temperature: modelConfig.temperature }
        db.prepare(`
          INSERT INTO room_agent_model_bindings (
            room_id, agent_id, model_profile_id, model, runtime, max_tokens, temperature, configured_by, extra_config, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
          ON CONFLICT(room_id, agent_id) DO UPDATE SET
            model_profile_id = excluded.model_profile_id,
            model = excluded.model,
            runtime = excluded.runtime,
            max_tokens = excluded.max_tokens,
            temperature = excluded.temperature,
            extra_config = excluded.extra_config,
            updated_at = excluded.updated_at
        `).run(
          roomId,
          agentId,
          modelConfig.modelProfileId || null,
          modelConfig.model || null,
          modelConfig.runtime || null,
          modelConfig.maxTokens || null,
          modelConfig.temperature ?? null,
          JSON.stringify(extra),
          now
        )
      } else {
        db.prepare('DELETE FROM room_agent_model_bindings WHERE room_id = ? AND agent_id = ?').run(roomId, agentId)
      }
    })
    tx()
    const agents = await this.getRoomAgents(roomId)
    const agent = agents.find((item) => item.id === agentId)
    if (!agent) throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    return agent
  }

  async getAgent(agentId: string): Promise<Agent> {
    const row = db.prepare(`SELECT a.*, COALESCE(u.nickname, u.username) owner_name FROM agents a LEFT JOIN users u ON u.id = a.owner_id WHERE a.id = ?`).get(agentId) as AgentRow | undefined
    if (!row) {
      throw { code: 'AGENT_NOT_FOUND', message: 'Agent not found' }
    }
    return rowToAgent(row)
  }

  async getUserAgents(ownerId: string): Promise<Agent[]> {
    const rows = db.prepare(`
      SELECT agents.*, COALESCE(u.nickname, u.username) owner_name FROM agents
      LEFT JOIN users u ON u.id = agents.owner_id
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
    `).all(ownerId, ownerId) as AgentRow[]
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
        CASE WHEN b.room_id IS NULL THEN NULL ELSE json_object('modelProfileId', b.model_profile_id, 'model', b.model, 'runtime', b.runtime, 'maxTokens', b.max_tokens, 'temperature', b.temperature) END as room_model_config,
        (SELECT MAX(last_active_at) FROM agent_sessions s WHERE s.room_id = ra.room_id AND s.agent_id = a.id) as agent_last_active_at
      FROM agents a INNER JOIN room_agents ra ON a.id = ra.agent_id
      LEFT JOIN users u ON u.id = a.owner_id
      LEFT JOIN room_agent_model_bindings b ON b.room_id = ra.room_id AND b.agent_id = ra.agent_id`
    const current = db.prepare(`${select} INNER JOIN rooms r ON r.id = ra.room_id WHERE ra.room_id = ? AND r.current_assistant_agent_id = a.id AND a.status != 'inactive' LIMIT 1`).get(roomId) as AgentRow | undefined
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
          'temperature', b.temperature
        ) END as room_model_config, (
        SELECT MAX(last_active_at)
        FROM agent_sessions s
        WHERE s.room_id = ra.room_id AND s.agent_id = a.id
      ) as agent_last_active_at
      FROM agents a
      INNER JOIN room_agents ra ON a.id = ra.agent_id
      LEFT JOIN users u ON u.id = a.owner_id
      LEFT JOIN room_agent_model_bindings b ON b.room_id = ra.room_id AND b.agent_id = ra.agent_id
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

  buildAgentSystemPrompt(agent: Agent): string {
    const cfg = agent.config || {}
    const tools = { ...DEFAULT_AGENT_TOOLS, ...(cfg.tools || {}) }
    const isRoomAssistant = agent.roomRole === 'assistant' && agent.autoEnabled
    const roomRoleType = isRoomAssistant ? 'assistant' : 'specialist'
    const behavior = {
      replyMode: isRoomAssistant ? 'auto_when_relevant' : 'mention_only',
      silentAllowed: true,
      ...(cfg.behavior || {})
    }
    const roleCapabilities = renderRoleCapabilitiesForPrompt(roomRoleType)
    const dreamMemory = Array.isArray(cfg.dreamMemory) && cfg.dreamMemory.length
      ? `【梦境复盘得到的避错规则】\n${cfg.dreamMemory.map((item: any) => `- ${item.text}`).join('\n')}`
      : ''
    const roomId = (cfg as any).roomId
    const growthMemories = roomId ? agentGrowthService.getEffectiveMemories(roomId, agent.id, 12) : []
    const growthMemory = growthMemories.length
      ? `【用户习惯与项目记忆】\n${growthMemories.map((item: any) => `- ${item.text}`).join('\n')}`
      : ''

    return [
      '你是 FreeChat 项目中的业务 Agent。',
      '',
      `【Agent 名称】${agent.name}`,
      `【房间身份】${isRoomAssistant ? '协调者' : '普通 Agent'}`,
      `【当前身份】你就是 ${agent.name}，当前 Agent ID 是 ${agent.id}。用户 @${agent.name} 或提到这个 ID 时，就是在直接要求你本人处理。`,
      '【自我识别硬规则】不要把当前 Agent 当作另一个协作者；不要说“已通知/转发/提醒 @自己”或“某某会处理”。如果房间里没有其他合适 Agent，就直接以第一人称处理并汇报。',
      roleCapabilities,
      agent.description ? `【业务职责/定制定位】${agent.description}` : '',
      agent.specialties?.length ? `【专长】${agent.specialties.join('、')}` : '',
      cfg.systemPrompt ? `【业务自定义提示词】\n${cfg.systemPrompt}` : '',
      growthMemory,
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
      '3. 处理长期事项时使用 task/progress。创建任何新任务、子任务或任务计划前，必须先执行 ./freechat task list 查看房间已有未关闭任务；发现同一目标/同名任务时必须复用已有 taskId，用 progress/update/subtask add 推进，禁止重新创建同类父任务。',
      '3.1 需要查看房间协作者时使用 ./freechat members list；协调者需要拉入已有业务 Agent 时可使用 ./freechat agent list-available 和 ./freechat agent add <名称或ID>；缺少必要 Agent 时可用 ./freechat agent create-request 发起创建确认卡，但必须等待用户确认。',
      '3.2 目录规则：当前工作区 res/ 只放你的私有草稿，用户项目正式文件必须通过 ./freechat file write/write-local 写到业务路径（如 星源纪/正文/...、星源纪/剧情/...），不要写项目路径 res/...。HTML 写到 ui/*.html 只是文件；要显示在页面区必须继续执行 ./freechat tab create-file 或 tab create-local。主交付页面/阅读页/看板页创建后必须加 --default 或执行 ./freechat tab set-default <tabId|标题>，让用户进入页面区直接看到默认首页。file write --show 只加入文件视图，不创建页面 Tab。页面内目录/导航要跨 FreeChat 页面跳转时，用 data-freechat-tab-id 或 data-freechat-tab-title，可选 data-freechat-anchor；普通 href 不能切换外层 Tab。HTML 可以修改，但 HTML 只负责展示和交互；小说卷/章/集目录必须来自 manifest.json，正文必须来自 Markdown 文件。新增/删除/修改集数时优先修改 manifest 和正文文件，不要把正文或硬编码目录塞进 HTML。',
      isRoomAssistant
        ? '4. 你是当前房间唯一的协调者入口和调度者；用户未明确 @ 其他 Agent 时，只代表自己/协调者响应。遇到复合任务、长内容任务、或明显命中其他 Agent 专长的任务，必须先用 ./freechat task list 查看已有任务，再用 members.list 查看协作者；有匹配 Agent 时禁止自己直接产出最终成品，必须复用已有任务或用 ./freechat task plan create-json 创建真实交互卡，或用 task/subtask --assignee 分派。禁止只用普通聊天文本/Markdown 表格假装任务计划。用户给出大致题材但缺少时长/受众等细节时，不要只追问；应先用合理默认假设创建计划卡，并在计划说明里写清可后续调整。'
        : '4. 你是普通 Agent，只处理人类明确 @ 或任务分派给自己的事项；不要抢协调者的入口职责。',
      '5. 不要通过普通聊天 @ 另一个 Agent 来制造自动对话；客服/协调场景需要另一个 Agent 继续对话时用 ./freechat room handoff --agent <名称> --reason <原因>；项目协作产出才优先通过任务/子任务分派。',
      '6. 回复要简洁、面向当前项目上下文。',
      '7. Agent 完成父任务时不要让任务直接隐藏；提交完成应进入 review/待审核，等待人类确认后才算 done。',
    ].filter(Boolean).join('\n')
  }

  async buildRoomContextFiles(roomId: string, currentAgent?: Agent): Promise<{ roomMd: string; membersMd: string; workgroupMd: string }> {
    const room = db.prepare('SELECT id, name, description, created_by, created_at, updated_at, workgroup_id FROM rooms WHERE id = ?').get(roomId) as any
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

    const currentAgentIds = new Set(currentAgent ? [currentAgent.id] : [])
    const currentAgentLine = currentAgent ? [
      `- ${currentAgent.name}（你 / 当前 Agent）`,
      `  - ID: ${currentAgent.id}`,
      `  - Type: ${currentAgent.roleType}`,
      `  - Room Role: ${currentAgent.roomRole || (currentAgent.roleType === 'assistant' ? 'assistant' : 'specialist')}`,
      `  - 规则: 这是你自己，不是可通知或转发的另一个 Agent。用户 @${currentAgent.name} 就是在直接叫你处理。`,
    ].join('\n') : ''

    const agentLines = agents.filter((a) => !currentAgentIds.has(a.id)).map((a) => {
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

    const membersMd = `# Members and Agents\n\n所有当前房间协作者如下。分派 Agent 时必须使用这里的 Agent 名称或 ID，例如：\`./freechat task create "任务" "说明" --assignee "Agent名称"\`。\n\n## Humans\n\n${humanLines || '- none'}\n\n## Current Agent\n\n${currentAgentLine || '- 当前为房间共享上下文，无单一当前 Agent'}\n\n## Other Agents\n\n${agentLines || '- none'}\n`

    const wg = room?.workgroup_id ? db.prepare('SELECT * FROM workgroups WHERE id = ?').get(room.workgroup_id) as any : null
    const wgMembers = wg ? db.prepare(`
      SELECT wm.role, u.id, u.username, u.nickname, u.identity_type
      FROM workgroup_members wm JOIN users u ON u.id = wm.user_id
      WHERE wm.workgroup_id = ?
      ORDER BY CASE wm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.nickname, u.username
    `).all(wg.id) as any[] : []
    const wgAgents = wg ? db.prepare(`
      SELECT wa.role workgroup_role, a.id, a.name, a.description, a.specialties, a.status, a.deployment
      FROM workgroup_agents wa JOIN agents a ON a.id = wa.agent_id
      WHERE wa.workgroup_id = ? AND wa.enabled = 1 AND a.status != 'inactive'
      ORDER BY a.name
    `).all(wg.id) as any[] : []
    const wgRooms = wg ? db.prepare(`SELECT id, name, room_kind, last_active_at FROM rooms WHERE workgroup_id = ? AND deleted_at IS NULL ORDER BY last_active_at DESC LIMIT 50`).all(wg.id) as any[] : []
    const wgMemberLines = wgMembers.map((m: any) => `- ${m.nickname || m.username} (@${m.username})\n  - ID: ${m.id}\n  - Workgroup Role: ${m.role}`).join('\n')
    const wgAgentLines = wgAgents.map((a: any) => {
      let specs: string[] = []
      try { specs = a.specialties ? JSON.parse(a.specialties) : [] } catch {}
      return [`- ${a.name}`, `  - ID: ${a.id}`, `  - Workgroup Role: ${a.workgroup_role}`, `  - Status: ${a.status}`, a.description ? `  - Description: ${a.description}` : '', specs.length ? `  - Specialties: ${specs.join('、')}` : ''].filter(Boolean).join('\n')
    }).join('\n')
    const wgRoomLines = wgRooms.map((r: any) => `- ${r.name}\n  - ID: ${r.id}\n  - Kind: ${r.room_kind || 'project'}`).join('\n')
    const workgroupMd = `# Workgroup Context\n\n${wg ? `- Workgroup ID: ${wg.id}\n- Name: ${wg.name}\n- Description: ${wg.description || ''}` : '- 当前房间未绑定工作组'}\n\n工作组是人和 Agent 的资源池。同一工作组内成员彼此可见；外部用户只应看到自己参与的房间。需要新建独立协作会话时，使用 \`./freechat room create\`，只能从当前工作组选择成员和 Agent。\n\n## Workgroup Humans\n\n${wgMemberLines || '- none'}\n\n## Workgroup Agents\n\n${wgAgentLines || '- none'}\n\n## Workgroup Rooms Visible To You\n\n${wgRoomLines || '- none'}\n`
    return { roomMd, membersMd, workgroupMd }
  }

  async ensurePackageWorkspaces(): Promise<void> {
    await agentPackageService.ensureSystemSkills().catch((err) => console.error('[agent-package] bootstrap system skills failed', err))
    const agents = (db.prepare(`SELECT a.*, COALESCE(u.nickname, u.username) owner_name FROM agents a LEFT JOIN users u ON u.id = a.owner_id WHERE a.status != 'inactive'`).all() as AgentRow[]).map(rowToAgent)
    for (const agent of agents) await agentPackageService.ensureAgentPackage(agent).catch((err) => console.error('[agent-package] bootstrap agent failed', agent.id, err))
    const rooms = db.prepare('SELECT id, name, description, created_by FROM rooms').all() as any[]
    for (const room of rooms) await agentPackageService.ensureRoomWorkspace(room.id, room).catch((err) => console.error('[agent-package] bootstrap room failed', room.id, err))
  }

  async refreshRoomAgentContext(roomId: string): Promise<void> {
    const agents = await this.getRoomAgents(roomId)
    await agentPackageService.ensureRoomWorkspace(roomId)
    const rootMetaDir = join(agentPackageService.roomDir(roomId), '.freechat')
    await mkdir(rootMetaDir, { recursive: true })
    const rootCtx = await this.buildRoomContextFiles(roomId)
    await writeFile(join(rootMetaDir, 'ROOM.md'), rootCtx.roomMd, 'utf8')
    await writeFile(join(rootMetaDir, 'MEMBERS.md'), rootCtx.membersMd, 'utf8')
    await writeFile(join(rootMetaDir, 'WORKGROUP.md'), rootCtx.workgroupMd, 'utf8')
    await tabFilesMapService.writeRoomMap(roomId)

    for (const agent of agents) {
      await agentPackageService.ensureRoomAgentWorkspace(roomId, agent)
      const metaDir = join(agentPackageService.roomAgentDir(roomId, agent.id), '.freechat')
      await mkdir(metaDir, { recursive: true })
      const ctx = await this.buildRoomContextFiles(roomId, agent)
      await writeFile(join(metaDir, 'ROOM.md'), ctx.roomMd, 'utf8')
      await writeFile(join(metaDir, 'MEMBERS.md'), ctx.membersMd, 'utf8')
      await writeFile(join(metaDir, 'WORKGROUP.md'), ctx.workgroupMd, 'utf8')
      await tabFilesMapService.writeAgentMap(roomId, agent.id)
    }
  }

  async prepareAgentWorkspace(roomId: string, agent: Agent, actorUserId?: string): Promise<string> {
    const workspaceDir = await agentPackageService.ensureRoomAgentWorkspace(roomId, agent)
    const packageDir = await agentPackageService.ensureAgentPackage(agent)
    const metaDir = join(workspaceDir, '.freechat')
    const skillsDir = join(workspaceDir, 'skills')
    const resDir = join(workspaceDir, 'res')
    const scriptsDir = join(workspaceDir, 'scripts')

    await mkdir(metaDir, { recursive: true })
    await mkdir(skillsDir, { recursive: true })
    await mkdir(resDir, { recursive: true })
    await mkdir(scriptsDir, { recursive: true })

    const toolToken = createAgentToolToken(roomId, agent.id, actorUserId)
    const toolApiUrl = `http://127.0.0.1:${config.port}`
    const contextFiles = await this.buildRoomContextFiles(roomId, agent)

    const cliPath = join(workspaceDir, 'freechat')
    const cliCjsPath = join(metaDir, 'freechat.cjs')
    await writeFile(cliPath, renderAgentCliWrapper(), 'utf8')
    await chmod(cliPath, 0o700)
    await writeFile(cliCjsPath, renderAgentCliCjs({ apiUrl: toolApiUrl, roomId, token: toolToken }), 'utf8')
    await chmod(cliCjsPath, 0o700)

    const agentGuide = `${renderAgentGuide(agent)}\n\n## Agent Package\n\n- 模板目录: ${packageDir}\n- 模板说明: ${join(packageDir, 'AGENT.md')}\n- 模板资源库: ${join(packageDir, 'res')}\n- 模板 Skills: ${join(packageDir, 'skills')}\n\n运行时必须先理解模板 AGENT.md；需要能力时读取对应 skills/<name>/SKILL.md。模板目录运行时只读，房间产物写入当前房间目录。系统公共 Skills 会自动挂载到当前 skills/，包括 pdf-reader、excel-reader、word-reader。\n\n## Room Workspace\n\n- 房间目录: ${agentPackageService.roomDir(roomId)}\n- 共享资料: ${join(agentPackageService.roomDir(roomId), 'shared')}\n- 产物目录: ${join(agentPackageService.roomDir(roomId), 'artifacts')}\n- 当前 Agent 工作区: ${workspaceDir}\n- 当前 Agent 私有工作目录: ${join(workspaceDir, 'workspace')}\n\n你可以读写房间 shared、artifacts、当前 Agent workspace/res/scripts/skills；不要修改其他 Agent 工作区。`

    const safeName = (name: string) => String(name || 'item').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'item'
    const skills = agentCapabilityService.listSkills(agent.id).filter((skill) => skill.enabled)
    for (const skill of skills) {
      const skillDir = join(skillsDir, safeName(skill.name))
      await mkdir(join(skillDir, 'res'), { recursive: true })
      await mkdir(join(skillDir, 'scripts'), { recursive: true })
      await writeFile(join(skillDir, 'SKILL.md'), skill.content || `# ${skill.name}\n\n## Description\n\n${skill.description || ''}\n`, 'utf8')
    }
    await agentPackageService.mountSystemSkills(skillsDir)
    const scripts = agentCapabilityService.listScripts(agent.id).filter((script) => script.enabled)
    for (const script of scripts) {
      const ext = script.language === 'python' ? 'py' : script.language === 'typescript' ? 'ts' : script.language === 'javascript' ? 'js' : script.language === 'bash' ? 'sh' : 'txt'
      const scriptPath = join(scriptsDir, `${safeName(script.name)}.${ext}`)
      await writeFile(scriptPath, script.content || '', 'utf8')
      if (script.runPolicy === 'agent_allowed' || script.language === 'bash') await chmod(scriptPath, 0o700).catch(() => {})
    }

    await writeFile(join(workspaceDir, 'AGENT.md'), agentGuide, 'utf8')
    await writeFile(join(workspaceDir, 'CLAUDE.md'), `${agentGuide}\n\n启动后请先遵守本文件和 .freechat/API.md。\n`, 'utf8')

    await writeFile(join(metaDir, 'ROOM.md'), contextFiles.roomMd, 'utf8')

    await writeFile(join(metaDir, 'MEMBERS.md'), contextFiles.membersMd, 'utf8')
    await writeFile(join(metaDir, 'WORKGROUP.md'), contextFiles.workgroupMd, 'utf8')

    await writeFile(join(metaDir, 'API.md'), renderAgentApiDoc(), 'utf8')
    await tabFilesMapService.writeAgentMap(roomId, agent.id)

    return workspaceDir
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
