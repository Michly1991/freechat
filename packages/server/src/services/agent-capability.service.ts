import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'

export type SkillInput = {
  name: string
  description?: string
  content?: string
  enabled?: boolean
  sortOrder?: number
}

export type ScriptInput = {
  name: string
  description?: string
  language?: string
  content?: string
  enabled?: boolean
  runPolicy?: string
  sortOrder?: number
}

function rowToSkill(row: any) {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    description: row.description || undefined,
    content: row.content || '',
    enabled: !!row.enabled,
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToScript(row: any) {
  return {
    id: row.id,
    agentId: row.agent_id,
    name: row.name,
    description: row.description || undefined,
    language: row.language || 'bash',
    content: row.content || '',
    enabled: !!row.enabled,
    runPolicy: row.run_policy || 'manual_only',
    sortOrder: row.sort_order || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class AgentCapabilityService {
  listSkills(agentId: string) {
    return (db.prepare('SELECT * FROM agent_skills WHERE agent_id = ? ORDER BY sort_order ASC, created_at ASC').all(agentId) as any[]).map(rowToSkill)
  }

  listScripts(agentId: string) {
    return (db.prepare('SELECT * FROM agent_scripts WHERE agent_id = ? ORDER BY sort_order ASC, created_at ASC').all(agentId) as any[]).map(rowToScript)
  }

  createSkill(agentId: string, input: SkillInput) {
    const id = `skill_${uuidv4()}`
    const now = Date.now()
    const maxOrder: any = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM agent_skills WHERE agent_id = ?').get(agentId)
    db.prepare(`
      INSERT INTO agent_skills (id, agent_id, name, description, content, enabled, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, agentId, input.name, input.description || null, input.content || '', input.enabled === false ? 0 : 1, input.sortOrder ?? ((maxOrder?.max_order ?? -1) + 1), now, now)
    this.markAgentModified(agentId)
    return rowToSkill(db.prepare('SELECT * FROM agent_skills WHERE id = ?').get(id))
  }

  updateSkill(agentId: string, skillId: string, input: Partial<SkillInput>) {
    const exists = db.prepare('SELECT id FROM agent_skills WHERE id = ? AND agent_id = ?').get(skillId, agentId)
    if (!exists) throw { code: 'SKILL_NOT_FOUND', message: 'Skill not found' }
    const fields: string[] = []
    const values: any[] = []
    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name) }
    if (input.description !== undefined) { fields.push('description = ?'); values.push(input.description || null) }
    if (input.content !== undefined) { fields.push('content = ?'); values.push(input.content) }
    if (input.enabled !== undefined) { fields.push('enabled = ?'); values.push(input.enabled ? 1 : 0) }
    if (input.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(input.sortOrder) }
    if (fields.length === 0) return rowToSkill(db.prepare('SELECT * FROM agent_skills WHERE id = ?').get(skillId))
    fields.push('updated_at = ?'); values.push(Date.now(), skillId, agentId)
    db.prepare(`UPDATE agent_skills SET ${fields.join(', ')} WHERE id = ? AND agent_id = ?`).run(...values)
    this.markAgentModified(agentId)
    return rowToSkill(db.prepare('SELECT * FROM agent_skills WHERE id = ?').get(skillId))
  }

  deleteSkill(agentId: string, skillId: string) {
    const result = db.prepare('DELETE FROM agent_skills WHERE id = ? AND agent_id = ?').run(skillId, agentId)
    if (result.changes === 0) throw { code: 'SKILL_NOT_FOUND', message: 'Skill not found' }
    this.markAgentModified(agentId)
  }

  createScript(agentId: string, input: ScriptInput) {
    const id = `script_${uuidv4()}`
    const now = Date.now()
    const maxOrder: any = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as max_order FROM agent_scripts WHERE agent_id = ?').get(agentId)
    db.prepare(`
      INSERT INTO agent_scripts (id, agent_id, name, description, language, content, enabled, run_policy, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, agentId, input.name, input.description || null, input.language || 'bash', input.content || '', input.enabled === false ? 0 : 1, input.runPolicy || 'manual_only', input.sortOrder ?? ((maxOrder?.max_order ?? -1) + 1), now, now)
    this.markAgentModified(agentId)
    return rowToScript(db.prepare('SELECT * FROM agent_scripts WHERE id = ?').get(id))
  }

  updateScript(agentId: string, scriptId: string, input: Partial<ScriptInput>) {
    const exists = db.prepare('SELECT id FROM agent_scripts WHERE id = ? AND agent_id = ?').get(scriptId, agentId)
    if (!exists) throw { code: 'SCRIPT_NOT_FOUND', message: 'Script not found' }
    const fields: string[] = []
    const values: any[] = []
    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name) }
    if (input.description !== undefined) { fields.push('description = ?'); values.push(input.description || null) }
    if (input.language !== undefined) { fields.push('language = ?'); values.push(input.language || 'bash') }
    if (input.content !== undefined) { fields.push('content = ?'); values.push(input.content) }
    if (input.enabled !== undefined) { fields.push('enabled = ?'); values.push(input.enabled ? 1 : 0) }
    if (input.runPolicy !== undefined) { fields.push('run_policy = ?'); values.push(input.runPolicy) }
    if (input.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(input.sortOrder) }
    if (fields.length === 0) return rowToScript(db.prepare('SELECT * FROM agent_scripts WHERE id = ?').get(scriptId))
    fields.push('updated_at = ?'); values.push(Date.now(), scriptId, agentId)
    db.prepare(`UPDATE agent_scripts SET ${fields.join(', ')} WHERE id = ? AND agent_id = ?`).run(...values)
    this.markAgentModified(agentId)
    return rowToScript(db.prepare('SELECT * FROM agent_scripts WHERE id = ?').get(scriptId))
  }

  deleteScript(agentId: string, scriptId: string) {
    const result = db.prepare('DELETE FROM agent_scripts WHERE id = ? AND agent_id = ?').run(scriptId, agentId)
    if (result.changes === 0) throw { code: 'SCRIPT_NOT_FOUND', message: 'Script not found' }
    this.markAgentModified(agentId)
  }

  cloneCapabilities(sourceAgentId: string, targetAgentId: string) {
    const now = Date.now()
    for (const skill of db.prepare('SELECT * FROM agent_skills WHERE agent_id = ? ORDER BY sort_order ASC').all(sourceAgentId) as any[]) {
      db.prepare(`
        INSERT INTO agent_skills (id, agent_id, name, description, content, enabled, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`skill_${uuidv4()}`, targetAgentId, skill.name, skill.description, skill.content, skill.enabled, skill.sort_order, now, now)
    }
    for (const script of db.prepare('SELECT * FROM agent_scripts WHERE agent_id = ? ORDER BY sort_order ASC').all(sourceAgentId) as any[]) {
      db.prepare(`
        INSERT INTO agent_scripts (id, agent_id, name, description, language, content, enabled, run_policy, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(`script_${uuidv4()}`, targetAgentId, script.name, script.description, script.language, script.content, script.enabled, script.run_policy, script.sort_order, now, now)
    }
  }

  markAgentModified(agentId: string) {
    db.prepare('UPDATE agents SET is_modified = 1, updated_at = ? WHERE id = ? AND COALESCE(is_template, 1) = 0').run(Date.now(), agentId)
  }
}

export const agentCapabilityService = new AgentCapabilityService()
