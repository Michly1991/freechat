import db from '../storage/db.js'
import { v4 as uuidv4 } from 'uuid'
import { agentService } from './agent.service.js'
import { templatePermissionService } from './template-permission.service.js'

const SCENE_AGENT_MANAGEMENT_ID = 'scene_agent_management'
const BUILT_IN_SCENE_KEY = 'agent_management'
const BUILT_IN_SCENE_NAMES = new Set(['Agent管理', 'Agent 管理'])

function normalizeSceneName(name: string) {
  return String(name || '').replace(/\s+/g, '')
}

function agentManagerPageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
    main { max-width: 1040px; margin: 0 auto; padding: 24px; }
    .hero { background: linear-gradient(135deg, #2563eb, #7c3aed); color: white; border-radius: 20px; padding: 24px; box-shadow: 0 20px 40px rgba(37, 99, 235, .18); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin-top: 18px; }
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; box-shadow: 0 6px 18px rgba(15, 23, 42, .05); }
    .badge { display: inline-flex; border-radius: 999px; padding: 3px 9px; background: #eef2ff; color: #4f46e5; font-size: 12px; margin: 3px 4px 0 0; }
    code { background: #0f172a; color: #dbeafe; display: block; padding: 12px; border-radius: 12px; overflow-x: auto; white-space: pre; }
    h1, h2, h3 { margin-top: 0; }
    p { line-height: 1.65; }
  </style>
</head>
<body>
<main>
  <section class="hero">
    <h1>Agent 管理页面</h1>
    <p>本页面由“Agent 管理”场景克隆到当前项目。这里用于可视化当前项目里的 Agent 副本、Skill、脚本、页面和模板更新状态。</p>
  </section>
  <section class="grid">
    <div class="card"><h3>Agent 副本</h3><p>项目里的 Agent 是从模板克隆而来，修改不会影响全局模板或其他项目。</p><span class="badge">clone</span><span class="badge">local editable</span></div>
    <div class="card"><h3>通用助理</h3><p>Agent 管理能力已融合进默认助理；由助理负责模板、Skill、Script、场景维护协助。</p><span class="badge">assistant</span><span class="badge">agent api</span></div>
    <div class="card"><h3>页面</h3><p>历史技术名 tab，产品语义统一叫页面。页面也由场景克隆进项目。</p><span class="badge">page</span></div>
  </section>
  <section class="card" style="margin-top: 18px;">
    <h2>给助理的 CLI 能力</h2>
    <code>./freechat members list
./freechat agent list-available
./freechat agent add "Agent名称"
./freechat tab list        # 兼容旧命令，产品上称为页面
./freechat tab create-local "Agent管理" res/agent-manager.html</code>
    <p>Agent 管理能力写入通用助理的拆分 Skill / Script；长参考资料放入 res，避免单个 Skill 过大。</p>
  </section>
</main>
</body>
</html>`
}

export class SceneTemplateService {
  ensureBuiltInScenes(ownerId: string) {
    const now = Date.now()
    db.prepare(`
      INSERT OR IGNORE INTO scene_templates (id, owner_id, built_in_key, name, description, icon, version, status, created_at, updated_at)
      VALUES (?, NULL, ?, 'Agent 管理', '系统内置 Agent 管理项目：维护全局 Agent 模板、项目内 Agent 副本、Skill、脚本和场景默认 Agent。', 'compass', 1, 'active', ?, ?)
    `).run(SCENE_AGENT_MANAGEMENT_ID, BUILT_IN_SCENE_KEY, now, now)

    db.prepare('UPDATE scene_templates SET built_in_key = ?, icon = ?, updated_at = ? WHERE id = ?').run(BUILT_IN_SCENE_KEY, 'compass', now, SCENE_AGENT_MANAGEMENT_ID)

    return { sceneId: SCENE_AGENT_MANAGEMENT_ID }
  }

  listScenes(user: { id: string; role?: string }) {
    this.ensureBuiltInScenes(user.id)
    return (db.prepare('SELECT id, owner_id as ownerId, built_in_key as builtInKey, name, description, icon, version, status FROM scene_templates WHERE status = ? ORDER BY created_at ASC').all('active') as any[])
      .map((scene) => this.hydrateScene(scene, user))
  }

  sceneHasAssistant(sceneId: string): boolean {
    const row = db.prepare(`
      SELECT 1
      FROM scene_template_agents sta
      INNER JOIN agents a ON a.id = sta.agent_template_id
      WHERE sta.scene_id = ? AND a.role_type = 'assistant'
      LIMIT 1
    `).get(sceneId)
    return !!row
  }

  hydrateScene(scene: any, viewer?: { id: string; role?: string } | string) {
    const viewerId = typeof viewer === 'string' ? viewer : viewer?.id
    const viewerRole = typeof viewer === 'string' ? undefined : viewer?.role
    const agents = db.prepare(`
      SELECT sta.id, sta.agent_template_id as agentId, sta.room_role as roomRole, sta.auto_enabled as autoEnabled, sta.priority,
             a.name, a.role_type as roleType, a.description
      FROM scene_template_agents sta
      LEFT JOIN agents a ON a.id = sta.agent_template_id
      WHERE sta.scene_id = ?
      ORDER BY sta.priority ASC, sta.created_at ASC
    `).all(scene.id) as any[]
    const canEdit = this.canEditSceneRecord(scene, viewerId, viewerRole)
    const owner = db.prepare('SELECT nickname, username FROM users WHERE id = ?').get(scene.ownerId || scene.owner_id) as any
    const rule = db.prepare('SELECT * FROM scene_billing_rules WHERE scene_template_id = ? AND enabled = 1').get(scene.id) as any
    return {
      ...scene,
      ownerName: owner?.nickname || owner?.username || scene.ownerId || scene.owner_id,
      isBuiltIn: scene.id === SCENE_AGENT_MANAGEMENT_ID || scene.builtInKey === BUILT_IN_SCENE_KEY || scene.built_in_key === BUILT_IN_SCENE_KEY,
      canEdit,
      priceSummary: rule ? (rule.billing_mode === 'free' ? '免费' : `固定 ${rule.fixed_credits_per_use || 0} credits/次`) : '暂无定价',
      billingRule: canEdit && rule ? { billingMode: rule.billing_mode, fixedCreditsPerUse: rule.fixed_credits_per_use || 0, enabled: !!rule.enabled } : undefined,
      agents: agents.map((agent) => ({ ...agent, autoEnabled: !!agent.autoEnabled })),
      pages: [],
    }
  }

  canEditSceneRecord(scene: any, userId?: string, userRole?: string): boolean {
    if (!userId) return false
    return templatePermissionService.canEdit('scene', scene.id, { id: userId, role: userRole })
  }

  upsertBillingRule(user: { id: string; role?: string }, sceneId: string, input: any) {
    const scene = db.prepare('SELECT id, owner_id as ownerId, built_in_key as builtInKey FROM scene_templates WHERE id = ?').get(sceneId) as any
    if (!scene) throw { code: 'SCENE_NOT_FOUND', message: 'Scene not found' }
    if (!this.canEditSceneRecord(scene, user.id, user.role)) throw { code: 'FORBIDDEN', message: 'Only the Scene owner/admin can edit this Scene' }
    const now = Date.now()
    const mode = input?.billingMode === 'fixed' ? 'fixed' : 'free'
    const fixed = Math.max(0, Math.trunc(Number(input?.fixedCreditsPerUse || 0)))
    db.prepare(`
      INSERT INTO scene_billing_rules (id, scene_template_id, billing_mode, fixed_credits_per_use, revenue_share_rate, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 1, ?, ?)
      ON CONFLICT(scene_template_id) DO UPDATE SET billing_mode = excluded.billing_mode, fixed_credits_per_use = excluded.fixed_credits_per_use, updated_at = excluded.updated_at
    `).run(`sbr_${uuidv4()}`, sceneId, mode, fixed, now, now)
    return this.hydrateScene(db.prepare('SELECT id, owner_id as ownerId, built_in_key as builtInKey, name, description, icon, version, status FROM scene_templates WHERE id = ?').get(sceneId), user)
  }

  async assertCanEditScene(sceneId: string, user: { id: string; role?: string }) {
    const scene = db.prepare('SELECT id, owner_id as ownerId, built_in_key as builtInKey FROM scene_templates WHERE id = ?').get(sceneId) as any
    if (!scene) throw { code: 'SCENE_NOT_FOUND', message: 'Scene not found' }
    if (!this.canEditSceneRecord(scene, user.id, user.role)) throw { code: 'FORBIDDEN', message: 'Only the Scene owner/admin can edit this Scene' }
  }

  createScene(ownerId: string, input: { name: string; description?: string; icon?: string; agents?: any[] }) {
    const name = String(input.name || '').trim()
    if (!name) throw { code: 'VALIDATION_ERROR', message: 'Scene name is required' }
    if (BUILT_IN_SCENE_NAMES.has(name) || normalizeSceneName(name) === 'Agent管理') {
      throw { code: 'BUILT_IN_SCENE_RESERVED', message: 'Agent 管理是系统内置项目，不能重复创建' }
    }
    const now = Date.now()
    const sceneId = `scene_${uuidv4()}`
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO scene_templates (id, owner_id, built_in_key, name, description, icon, version, status, created_at, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?, 1, 'active', ?, ?)
      `).run(sceneId, ownerId, name, input.description || null, input.icon || 'compass', now, now)
    })
    tx()
    return this.updateScene({ id: ownerId }, sceneId, { agents: input.agents || [] })
  }

  updateScene(user: { id: string; role?: string }, sceneId: string, input: { name?: string; description?: string; icon?: string; agents?: any[] }) {
    const exists = db.prepare('SELECT id, owner_id as ownerId, built_in_key as builtInKey FROM scene_templates WHERE id = ?').get(sceneId) as any
    if (!exists) throw { code: 'SCENE_NOT_FOUND', message: 'Scene not found' }
    if (!this.canEditSceneRecord(exists, user.id, user.role)) throw { code: 'FORBIDDEN', message: 'Only the Scene owner/admin can edit this Scene' }
    const fields: string[] = []
    const values: any[] = []
    const isBuiltIn = exists.builtInKey === BUILT_IN_SCENE_KEY || sceneId === SCENE_AGENT_MANAGEMENT_ID
    if (!isBuiltIn && input.name !== undefined) { fields.push('name = ?'); values.push(String(input.name).trim()) }
    if (!isBuiltIn && input.description !== undefined) { fields.push('description = ?'); values.push(input.description || null) }
    if (input.icon !== undefined) { fields.push('icon = ?'); values.push(input.icon || null) }
    const now = Date.now()
    const tx = db.transaction(() => {
      if (fields.length > 0) {
        fields.push('updated_at = ?')
        values.push(now, sceneId)
        db.prepare(`UPDATE scene_templates SET ${fields.join(', ')} WHERE id = ?`).run(...values)
      }
      if (Array.isArray(input.agents)) {
        db.prepare('DELETE FROM scene_template_agents WHERE scene_id = ?').run(sceneId)
        const insert = db.prepare(`
          INSERT INTO scene_template_agents (id, scene_id, agent_template_id, room_role, auto_enabled, priority, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        input.agents.forEach((agent, index) => {
          if (!agent.agentId) return
          const template = db.prepare('SELECT role_type FROM agents WHERE id = ? AND COALESCE(is_template, 1) = 1 AND status != ?').get(agent.agentId, 'inactive') as any
          const roomRole = template?.role_type === 'assistant' ? 'assistant' : 'specialist'
          insert.run(`scene_agent_${uuidv4()}`, sceneId, agent.agentId, roomRole, roomRole === 'assistant' && agent.autoEnabled ? 1 : 0, Number(agent.priority ?? index), now, now)
        })
      }
    })
    tx()
    return this.hydrateScene(db.prepare('SELECT id, owner_id as ownerId, built_in_key as builtInKey, name, description, icon, version, status FROM scene_templates WHERE id = ?').get(sceneId), user)
  }

  async applySceneToRoom(sceneId: string, roomId: string, userId: string) {
    this.ensureBuiltInScenes(userId)
    const scene = this.hydrateScene(db.prepare('SELECT id, owner_id as ownerId, built_in_key as builtInKey, name, description, icon, version, status FROM scene_templates WHERE id = ?').get(sceneId), userId)
    if (!scene) return
    const clonedAgents = [] as any[]
    for (const sceneAgent of scene.agents || []) {
      const cloned = await agentService.cloneAgentTemplate(sceneAgent.agentId, userId, { roomId })
      clonedAgents.push({ ...sceneAgent, cloned })
    }
    const now = Date.now()
    const primaryAssistant = clonedAgents.find((agent) => agent.cloned.roleType === 'assistant' && agent.autoEnabled)
      || clonedAgents.find((agent) => agent.cloned.roleType === 'assistant')
    const tx = db.transaction(() => {
      db.prepare('UPDATE rooms SET scene_template_id = ?, scene_template_version = ? WHERE id = ?').run(sceneId, scene.version || 1, roomId)
      const sceneHasAssistant = clonedAgents.some((agent) => agent.cloned.roleType === 'assistant')
      if (sceneHasAssistant) {
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
      }
      if (clonedAgents.some((agent) => agent.autoEnabled)) db.prepare('UPDATE room_agents SET auto_enabled = 0 WHERE room_id = ?').run(roomId)
      for (const agent of clonedAgents) {
        const isPrimaryAssistant = primaryAssistant?.cloned?.id === agent.cloned.id
        db.prepare(`
          INSERT OR REPLACE INTO room_agents (room_id, agent_id, added_by, added_at, room_role, auto_enabled, priority)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(roomId, agent.cloned.id, userId, now, isPrimaryAssistant ? 'assistant' : 'specialist', isPrimaryAssistant ? 1 : 0, Number(agent.priority || 0))
      }
    })
    tx()
  }
}

export const sceneTemplateService = new SceneTemplateService()
