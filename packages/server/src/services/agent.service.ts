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
  agent_last_active_at?: number | null
}

export interface AgentConfig {
  name: string
  roleType: 'assistant' | 'specialist'
  deployment: 'server' | 'client'
  description?: string
  specialties?: string[]
  config?: Record<string, any>
  status?: 'active' | 'inactive' | 'working' | 'error'
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
      SELECT a.*, (
        SELECT MAX(last_active_at)
        FROM agent_sessions s
        WHERE s.room_id = ra.room_id AND s.agent_id = a.id
      ) as agent_last_active_at
      FROM agents a
      INNER JOIN room_agents ra ON a.id = ra.agent_id
      WHERE ra.room_id = ?
      ORDER BY ra.added_at ASC
    `).all(roomId) as AgentRow[]
    return rows.map(r => this.rowToAgent(r))
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
const fs = require('fs');
const path = require('path');

const API_URL = ${JSON.stringify(toolApiUrl)};
const ROOM_ID = ${JSON.stringify(roomId)};
const TOKEN = ${JSON.stringify(toolToken)};

function usage() {
  console.log([
    'FreeChat Agent CLI',
    '',
    'Principle:',
    '  - Project-visible files must go through ./freechat file ...',
    '  - Files are not visible in the File Tab unless added to tab config.',
    '  - User-visible UI pages must go through ./freechat tab ...',
    '',
    'Common workflows:',
    '  ./freechat chat send "我开始处理这个任务"',
    '  ./freechat file write docs/progress.md "进度内容" --show',
    '  ./freechat file write-local ui/dashboard.html res/dashboard.html --show',
    '  ./freechat tab create-local "数据看板" res/dashboard.html',
    '  ./freechat tab update-local <tabId> res/dashboard.html',
    '',
    'Commands:',
    '  ./freechat chat send <content>',
    '  ./freechat task list [status]',
    '  ./freechat task create <title> [description]',
    '  ./freechat task update <taskId> <field> <value> [field value...]',
    '  ./freechat file list',
    '  ./freechat file read <path>',
    '  ./freechat file write <path> <content> [--show|--hide]',
    '  ./freechat file write-local <path> <localPath> [--show|--hide]',
    '  ./freechat file show <path> [tabKey]',
    '  ./freechat file hide <path> [tabKey]',
    '  ./freechat tab-config list [tabKey]',
    '  ./freechat tab-config add-file <path> [tabKey]',
    '  ./freechat tab-config remove-file <path> [tabKey]',
    '  ./freechat tab list',
    '  ./freechat tab create <title> <htmlContent>',
    '  ./freechat tab create-file <title> <projectFilePath>',
    '  ./freechat tab create-local <title> <localPath>',
    '  ./freechat tab update <tabId> <htmlContent>',
    '  ./freechat tab update-file <tabId> <projectFilePath>',
    '  ./freechat tab update-local <tabId> <localPath>',
    '  ./freechat tab delete <tabId>',
    '  ./freechat tab reorder <tabId> [tabId...]',
    '  ./freechat members list',
    '  ./freechat room info',
    '  ./freechat raw <action> \'<jsonArgs>\'',
    '',
    'Compatibility aliases:',
    '  tab create-from-file/update-from-file, tab create-from-local/update-from-local',
    '  file write <path> <content> true  (same as --show)',
  ].join('\n'));
}

function die(message) {
  console.error(message);
  console.error('Run ./freechat help for usage.');
  process.exit(2);
}

function readLocalFile(localPath) {
  if (!localPath) die('localPath is required');
  const resolved = path.resolve(process.cwd(), localPath);
  if (!fs.existsSync(resolved)) die('Local file not found: ' + localPath);
  return fs.readFileSync(resolved, 'utf8');
}

function stripFlags(items) {
  const flags = new Set(items.filter((x) => String(x).startsWith('--')));
  return { args: items.filter((x) => !String(x).startsWith('--')), flags };
}

function parseShowFlag(items) {
  const { args, flags } = stripFlags(items);
  const tail = args[args.length - 1];
  const legacyShow = tail === 'true' || tail === '1';
  const legacyHide = tail === 'false' || tail === '0';
  const cleanedArgs = (legacyShow || legacyHide) ? args.slice(0, -1) : args;
  return { args: cleanedArgs, show: flags.has('--show') || flags.has('--add-to-tab') || legacyShow, hide: flags.has('--hide') || legacyHide };
}

function pairsToObject(items) {
  const out = {};
  for (let i = 0; i < items.length; i += 2) {
    if (!items[i]) continue;
    out[items[i]] = items[i + 1];
  }
  return out;
}

async function call(action, args = {}) {
  const res = await fetch(API_URL + '/api/agent-tools/' + ROOM_ID, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
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

const [domain, cmd, ...rest] = process.argv.slice(2);
if (!domain || ['-h', '--help', 'help'].includes(domain)) {
  usage();
  process.exit(0);
}

if (domain === 'chat' && cmd === 'send') {
  const content = rest.join(' ').trim();
  if (!content) die('content is required');
  call('chat.send', { content });
} else if (domain === 'task' && cmd === 'list') {
  call('task.list', { status: rest[0] });
} else if (domain === 'task' && cmd === 'create') {
  if (!rest[0]) die('title is required');
  call('task.create', { title: rest[0], description: rest.slice(1).join(' ') || undefined });
} else if (domain === 'task' && cmd === 'update') {
  if (!rest[0]) die('taskId is required');
  call('task.update', { taskId: rest[0], updates: pairsToObject(rest.slice(1)) });
} else if (domain === 'file' && cmd === 'list') {
  call('file.list');
} else if (domain === 'file' && cmd === 'read') {
  if (!rest[0]) die('path is required');
  call('file.read', { path: rest[0] });
} else if (domain === 'file' && cmd === 'write') {
  const parsed = parseShowFlag(rest);
  if (!parsed.args[0]) die('path is required');
  const content = parsed.args.slice(1).join(' ');
  call('file.write', { path: parsed.args[0], content, addToTab: parsed.show && !parsed.hide });
} else if (domain === 'file' && cmd === 'write-local') {
  const parsed = parseShowFlag(rest);
  if (!parsed.args[0]) die('path is required');
  const content = readLocalFile(parsed.args[1]);
  call('file.write', { path: parsed.args[0], content, addToTab: parsed.show && !parsed.hide });
} else if (domain === 'file' && cmd === 'show') {
  if (!rest[0]) die('path is required');
  call('tab-config.add-file', { path: rest[0], tabKey: rest[1] || 'files' });
} else if (domain === 'file' && cmd === 'hide') {
  if (!rest[0]) die('path is required');
  call('tab-config.remove-file', { path: rest[0], tabKey: rest[1] || 'files' });
} else if (domain === 'tab-config' && cmd === 'list') {
  call('tab-config.list', { tabKey: rest[0] || 'files' });
} else if (domain === 'tab-config' && cmd === 'add-file') {
  if (!rest[0]) die('path is required');
  call('tab-config.add-file', { path: rest[0], tabKey: rest[1] || 'files' });
} else if (domain === 'tab-config' && cmd === 'remove-file') {
  if (!rest[0]) die('path is required');
  call('tab-config.remove-file', { path: rest[0], tabKey: rest[1] || 'files' });
} else if (domain === 'tab' && cmd === 'list') {
  call('tab.list');
} else if (domain === 'tab' && cmd === 'create') {
  if (!rest[0]) die('title is required');
  call('tab.create', { title: rest[0], content: rest.slice(1).join(' ') });
} else if (domain === 'tab' && ['create-file', 'create-from-file'].includes(cmd)) {
  if (!rest[0] || !rest[1]) die('title and projectFilePath are required');
  call('tab.create-from-file', { title: rest[0], path: rest[1] });
} else if (domain === 'tab' && ['create-local', 'create-from-local'].includes(cmd)) {
  if (!rest[0] || !rest[1]) die('title and localPath are required');
  call('tab.create', { title: rest[0], content: readLocalFile(rest[1]) });
} else if (domain === 'tab' && cmd === 'update') {
  if (!rest[0]) die('tabId is required');
  call('tab.update', { tabId: rest[0], content: rest.slice(1).join(' ') });
} else if (domain === 'tab' && ['update-file', 'update-from-file'].includes(cmd)) {
  if (!rest[0] || !rest[1]) die('tabId and projectFilePath are required');
  call('tab.update', { tabId: rest[0], path: rest[1] });
} else if (domain === 'tab' && ['update-local', 'update-from-local'].includes(cmd)) {
  if (!rest[0] || !rest[1]) die('tabId and localPath are required');
  call('tab.update', { tabId: rest[0], content: readLocalFile(rest[1]) });
} else if (domain === 'tab' && cmd === 'delete') {
  if (!rest[0]) die('tabId is required');
  call('tab.delete', { tabId: rest[0] });
} else if (domain === 'tab' && cmd === 'reorder') {
  if (rest.length === 0) die('at least one tabId is required');
  call('tab.reorder', { tabIds: rest });
} else if (domain === 'members' && cmd === 'list') {
  call('members.list');
} else if (domain === 'room' && cmd === 'info') {
  call('room.info');
} else if (domain === 'raw') {
  call(cmd, rest[0] ? JSON.parse(rest[0]) : {});
} else {
  die('Unknown command: ' + [domain, cmd].filter(Boolean).join(' '));
}
`, 'utf8')
    await chmod(cliPath, 0o700)

    const agentGuide = `# ${agent.name} Agent 工作区

你是 FreeChat 房间中的 ${agent.roleType === 'assistant' ? '助理 Agent' : '专家 Agent'}。

## 当前 Agent
- Agent ID: ${agent.id}
- 名称: ${agent.name}
- 类型: ${agent.roleType}
- 描述: ${agent.description || ''}
- 专长: ${(agent.specialties || []).join(', ') || '未设置'}

## 目录约定
- \`skills/\`：只放你自己的技能说明、方法论、模板。
- \`res/\`：只放你自己的临时资料、草稿、缓存、中间产物。
- \`scripts/\`：只放你自己的脚本。
- \`.freechat/\`：系统注入的房间上下文和 API 说明。
- 当前目录是你的私有 Agent 工作区，不是用户项目文件区。

## 强制规则
1. 不要直接写入用户项目文件目录，不要访问或修改 \`../../files\`。
2. 用户可见的项目文件必须通过 API 写入：
   - 写文本：\`./freechat file write <path> <content>\`
   - 写本地文件：\`./freechat file write-local <path> <localPath>\`
   - 显示到文件 Tab：加 \`--show\`，或执行 \`./freechat file show <path>\`
3. 读取用户项目文件必须通过 API：\`./freechat file read <path>\` 或 \`./freechat file list\`。
4. 用户可见界面必须通过 Tab API 创建/更新：
   - 推荐：\`./freechat tab create-local <title> res/page.html\`
   - 从项目文件：\`./freechat tab create-file <title> ui/page.html\`
5. 你自己的草稿、脚本、技能、资源可以放在当前工作区的 \`res/\`、\`scripts/\`、\`skills/\`。
6. 长任务开始时先用 \`./freechat chat send\` 汇报，必要时同步任务状态。

## 推荐工作流
- 文档/交付物：先写到项目文件，必要时 \`--show\`。
- 界面/看板：先在 \`res/\` 生成 HTML，再用 \`tab create-local/update-local\` 发布。
- 大段内容不要塞进命令行参数，优先使用 \`write-local/create-local/update-local\`。
`

    await writeFile(join(workspaceDir, 'AGENT.md'), agentGuide, 'utf8')
    await writeFile(join(workspaceDir, 'CLAUDE.md'), `${agentGuide}\n\n启动后请先遵守本文件和 .freechat/API.md。\n`, 'utf8')

    await writeFile(join(metaDir, 'ROOM.md'), `# Room Context\n\n- Room ID: ${roomId}\n- Name: ${room?.name || ''}\n- Description: ${room?.description || ''}\n- Current Agent: ${agent.name}\n- Agent ID: ${agent.id}\n- Agent Role: ${agent.roleType}\n`, 'utf8')

    await writeFile(join(metaDir, 'MEMBERS.md'), `# Members\n\n## Humans\n${members.map((m) => `- ${m.nickname || m.username} (@${m.username}) - ${m.role}`).join('\n') || '- none'}\n\n## Agents\n${agents.map((a) => `- ${a.name} (${a.roleType}) - ${a.status || 'active'}`).join('\n') || '- none'}\n`, 'utf8')

    await writeFile(join(metaDir, 'API.md'), `# FreeChat CLI Contract

Agent 必须通过根目录的 \`./freechat\` CLI 同步工作进度、项目文件和用户可见界面。

## 快速工作流

### 聊天汇报

\`\`\`bash
./freechat chat send "我开始处理这个任务"
\`\`\`

### 项目文件

\`\`\`bash
./freechat file list
./freechat file read docs/example.md
./freechat file write docs/progress.md "进度内容" --show
./freechat file write-local docs/report.md res/report.md --show
./freechat file show docs/report.md
./freechat file hide docs/report.md
\`\`\`

说明：文件写入项目区后，只有加入 Tab 配置才会出现在页面“文件”Tab。\`--show\` 等价于写入后加入文件 Tab。

### 动态界面 Tab

\`\`\`bash
./freechat tab list
./freechat tab create-local "项目看板" res/dashboard.html
./freechat tab update-local <tabId> res/dashboard.html
./freechat tab create-file "项目看板" ui/dashboard.html
./freechat tab update-file <tabId> ui/dashboard.html
./freechat tab delete <tabId>
./freechat tab reorder <tabId> [tabId...]
\`\`\`

推荐：先在 \`res/\` 里生成 HTML，检查后用 \`tab create-local\` 发布；如果 HTML 也需要作为项目交付物留档，再使用 \`file write-local ui/dashboard.html res/dashboard.html --show\`。

### 任务

\`\`\`bash
./freechat task list
./freechat task create "拆分任务标题" "任务说明"
./freechat task update <taskId> status doing
./freechat task update <taskId> status review reviewNote "已完成，等待确认"
./freechat task update <taskId> status done
\`\`\`

### 房间上下文

\`\`\`bash
./freechat members list
./freechat room info
\`\`\`

## 规则

- 当前目录是 Agent 私有工作区，可以使用 \`skills/\`、\`res/\`、\`scripts/\` 保存自己的资料。
- 用户可见的项目文件只能通过 \`./freechat file write/write-local\` 写入。
- 文件是否出现在“文件”Tab 由 Tab 配置控制：\`./freechat file show/hide\` 或 \`./freechat tab-config add-file/remove-file\`。
- 用户可见界面只能通过 \`./freechat tab create/update/delete\` 管理。
- 大段 HTML/Markdown 优先放本地文件，再用 \`*-local\` 命令读取。
- 用户项目文件只能通过 \`./freechat file read/list\` 读取。
- 不要直接访问或写入 \`../../files\`；即使能访问，也视为越权。
`, 'utf8')

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
          this.cleanupAgentHistory(newSessionId)
          this.cleanupOldAgentSessions(roomId, agentId)

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
        return { response: result.response, silent: result.silent }
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
