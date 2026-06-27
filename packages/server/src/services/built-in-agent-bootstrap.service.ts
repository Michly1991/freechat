import { randomBytes, randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import db from '../storage/db.js'
import { DEFAULT_ASSISTANT_AGENT_CONFIG, type AgentRuntimeConfig, type AgentSkill } from '@freechat/shared'
import { SYSTEM_ADMIN_USER_ID } from './system-admin.service.js'
import { agentPackageService } from './agent-package.service.js'
import { agentCapabilityService } from './agent-capability.service.js'
import { rowToAgent, type AgentRow } from './agent-mapper.js'
import { XIAOMI_AGENT_BUILT_IN_KEY } from './built-in-agent-constants.js'
import { remoteAgentConnectorService } from './remote-agent-connector.service.js'

const XIAOMI_SYSTEM_PROMPT = `你是 FreeChat 平台内置助手「小蜜」，定位是每个用户的客户端级 AI 助手。

核心职责：
1. 帮用户理解和操作 FreeChat：Agent、Skill、Script、项目/房间、任务、文件、页面、成员和协作流程。
2. 在一对一私聊里直接回应用户；涉及项目协作时，引导用户进入相关项目或用 FreeChat 工具执行。
3. 代用户创建、修改 Agent / Skill / Script / 场景等能力时，必须遵守当前用户权限，并优先通过确认卡或任务计划让用户确认。
4. 删除、权限变更、外部消息、API Key、账号/平台设置等高风险操作，必须先解释影响并获得明确确认；不得静默执行。
5. 不能绕过 owner/admin/editor 等权限；工具调用的权限主体应是当前对话发起人或交互卡确认人，而不是小蜜自己。
6. 维护 FreeChat 项目产物时，代码、Markdown、Skill 文档接近或超过 500 行必须拆分；Skill 只保留流程/边界，脚本放 scripts，长参考放 res。
7. 回复要简洁、可靠，优先给可执行下一步。能力不足或权限不足时说明原因并给替代方案。`

const XIAOMI_CORE_SKILL = `# 小蜜平台助手

## Description

你是 FreeChat 平台内置助手「小蜜」。当用户询问或要求操作 Agent、Skill、Script、项目/房间、任务、文件、页面、成员、协作流程或平台设置时使用本 Skill。

## Responsibilities

- 帮用户理解 FreeChat 当前能力，并给出可执行下一步。
- 通过 \`./freechat\` 工具操作房间、任务、文件、Tab、成员、Agent、Skill 和 Script。
- 对复杂变更先生成方案、任务计划或确认卡，再等待用户确认。
- 对权限、删除、外部消息、API Key、账号/平台设置等高风险操作，先说明影响并显式确认。

## Permission Rules

1. 所有读写都按当前用户/交互确认人的权限执行，不能用小蜜或系统管理员身份绕过权限。
2. 不能静默执行危险操作；必须使用 \`interaction.confirm\` 或明确文本确认。
3. 工具失败时说明真实错误，不要假装已经完成。

## File / Skill Size Rules

- 代码、Markdown、Skill 文档接近或超过 500 行时必须拆分。
- Skill 只保留触发条件、流程和边界；脚本放 \`scripts/\`；长参考、模板、API 清单放 \`res/\`。
`

function xiaomiConfig(): AgentRuntimeConfig {
  return {
    ...DEFAULT_ASSISTANT_AGENT_CONFIG,
    builtInKey: XIAOMI_AGENT_BUILT_IN_KEY,
    locked: true,
    behavior: { replyMode: 'auto_when_relevant', silentAllowed: true },
    tools: { chat: true, task: true, file: true, tab: true, interaction: true, members: true },
    systemPrompt: XIAOMI_SYSTEM_PROMPT,
  }
}

function ensureCoreSkill(agentId: string) {
  const existing = agentCapabilityService.listSkills(agentId).find((skill) => skill.name === '小蜜平台助手')
  if (existing) {
    const skill = agentCapabilityService.updateSkill(agentId, existing.id, { description: 'FreeChat 平台操作、Agent/Skill 管理和权限确认边界。', content: XIAOMI_CORE_SKILL, enabled: true, sortOrder: 0 }) as AgentSkill
    void agentPackageService.writeSkillPackage(agentId, skill).catch((err) => console.error('[built-in-agent] write xiaomi skill package failed', err))
    return
  }
  const skill = agentCapabilityService.createSkill(agentId, { name: '小蜜平台助手', description: 'FreeChat 平台操作、Agent/Skill 管理和权限确认边界。', content: XIAOMI_CORE_SKILL, enabled: true, sortOrder: 0 })
  void agentPackageService.writeSkillPackage(agentId, skill).catch((err) => console.error('[built-in-agent] write xiaomi skill package failed', err))
}

export class BuiltInAgentBootstrapService {
  ensureXiaomiAgent(): string {
    const now = Date.now()
    const config = xiaomiConfig()
    const existing = db.prepare(`
      SELECT a.*, COALESCE(u.nickname, u.username) owner_name
      FROM agents a
      LEFT JOIN users u ON u.id = a.owner_id
      WHERE a.config LIKE ?
      ORDER BY a.created_at ASC
      LIMIT 1
    `).get(`%"builtInKey":"${XIAOMI_AGENT_BUILT_IN_KEY}"%`) as AgentRow | undefined

    if (existing?.id) {
      db.prepare(`
        UPDATE agents
        SET owner_id = ?, name = ?, role_type = 'assistant', deployment = 'client', description = ?, specialties = ?, config = ?, status = 'active', is_template = 1, updated_at = ?
        WHERE id = ?
      `).run(
        SYSTEM_ADMIN_USER_ID,
        '小蜜',
        'FreeChat 平台内置助手，帮助每个用户操作 Agent、Skill、项目协作和平台能力。',
        JSON.stringify(['FreeChat 使用助手', 'Agent 管理', 'Skill/Script 协助', '项目协作', '权限确认']),
        JSON.stringify(config),
        now,
        existing.id
      )
      ensureCoreSkill(existing.id)
      this.ensureXiaomiBillingRule(existing.id, now)
      remoteAgentConnectorService.ensurePlatformHostedConnector(existing.id, SYSTEM_ADMIN_USER_ID)
      void agentPackageService.ensureAgentPackage(rowToAgent({ ...existing, owner_id: SYSTEM_ADMIN_USER_ID, name: '小蜜', role_type: 'assistant', deployment: 'client', description: 'FreeChat 平台内置助手，帮助每个用户操作 Agent、Skill、项目协作和平台能力。', specialties: JSON.stringify(['FreeChat 使用助手', 'Agent 管理', 'Skill/Script 协助', '项目协作', '权限确认']), config: JSON.stringify(config), status: 'active', is_template: 1, updated_at: now })).catch((err) => console.error('[built-in-agent] ensure xiaomi package failed', err))
      return existing.id
    }

    const id = `agent_${randomUUID()}`
    const apiKey = `fc_${randomBytes(32).toString('hex')}`
    const apiKeyHash = bcrypt.hashSync(apiKey, 10)
    db.prepare(`
      INSERT INTO agents (id, owner_id, name, role_type, deployment, description, specialties, config, api_key_hash, status, is_template, template_version, created_at, updated_at)
      VALUES (?, ?, ?, 'assistant', 'client', ?, ?, ?, ?, 'active', 1, 1, ?, ?)
    `).run(
      id,
      SYSTEM_ADMIN_USER_ID,
      '小蜜',
      'FreeChat 平台内置助手，帮助每个用户操作 Agent、Skill、项目协作和平台能力。',
      JSON.stringify(['FreeChat 使用助手', 'Agent 管理', 'Skill/Script 协助', '项目协作', '权限确认']),
      JSON.stringify(config),
      apiKeyHash,
      now,
      now
    )
    const row = db.prepare(`SELECT a.*, COALESCE(u.nickname, u.username) owner_name FROM agents a LEFT JOIN users u ON u.id = a.owner_id WHERE a.id = ?`).get(id) as AgentRow
    ensureCoreSkill(id)
    this.ensureXiaomiBillingRule(id, now)
    remoteAgentConnectorService.ensurePlatformHostedConnector(id, SYSTEM_ADMIN_USER_ID)
    void agentPackageService.ensureAgentPackage(rowToAgent(row)).catch((err) => console.error('[built-in-agent] ensure xiaomi package failed', err))
    return id
  }

  getXiaomiAgentId(): string {
    const row = db.prepare('SELECT id FROM agents WHERE config LIKE ? AND status != ? ORDER BY created_at ASC LIMIT 1').get(`%"builtInKey":"${XIAOMI_AGENT_BUILT_IN_KEY}"%`, 'inactive') as any
    if (row?.id) return row.id
    return this.ensureXiaomiAgent()
  }

  isXiaomiAgentId(agentId: string): boolean {
    const row = db.prepare('SELECT config FROM agents WHERE id = ?').get(agentId) as any
    return String(row?.config || '').includes(`"builtInKey":"${XIAOMI_AGENT_BUILT_IN_KEY}"`)
  }

  private ensureXiaomiBillingRule(agentId: string, now = Date.now()) {
    db.prepare(`
      INSERT INTO agent_billing_rules (id, agent_template_id, billing_mode, token_multiplier, fixed_credits_per_run, fixed_credits_per_purchase, input_credit_per_million, output_credit_per_million, cache_write_credit_per_million, cache_read_credit_per_million, min_credits_per_run, model_free_runs_per_day, model_overage_policy, revenue_share_rate, enabled, created_at, updated_at)
      VALUES (?, ?, 'free', 0, 0, 0, 0, 0, 0, 0, 0, 20, 'charge', 1, 1, ?, ?)
      ON CONFLICT(agent_template_id) DO UPDATE SET billing_mode = 'free', model_free_runs_per_day = 20, model_overage_policy = 'charge', updated_at = excluded.updated_at
    `).run(`abr_${randomUUID()}`, agentId, now, now)
  }
}

export const builtInAgentBootstrapService = new BuiltInAgentBootstrapService()
