import db from '../storage/db.js'
import { chmod, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { config } from '../config.js'
import { createAgentToolToken } from '../agent-tool-token.js'
import { renderAgentCliCjs, renderAgentCliWrapper } from './agent-cli-template.js'
import { renderAgentApiDoc, renderAgentGuide } from './agent-workspace-template.js'
import type { Agent, AgentToolPermissions } from '@freechat/shared'
import { DEFAULT_AGENT_TOOLS } from '@freechat/shared'
import { agentCapabilityService } from './agent-capability.service.js'
import { renderRoleCapabilitiesForPrompt } from './agent-role-capabilities.js'
import { tabFilesMapService } from './tab-files-map.service.js'
import { agentGrowthService } from './agent-growth.service.js'
import { agentPackageService } from './agent-package.service.js'
import { rowToAgent, type AgentRow } from './agent-mapper.js'

export class AgentWorkspaceService {
  async getRoomAgents(roomId: string): Promise<Agent[]> { throw new Error('not implemented') }
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
      '3.1 需要查看用户自己的 Agent 列表时使用 ./freechat agent my-list；需要查看房间协作者时使用 ./freechat members list；协调者需要拉入已有业务 Agent 时可使用 ./freechat agent list-available 和 ./freechat agent add <名称或ID>；缺少必要 Agent 时可用 ./freechat agent create-request 发起创建确认卡，但必须等待用户确认。',
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
}
