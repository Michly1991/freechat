export type AppActionRisk = 'read' | 'normal_write' | 'sensitive_write' | 'dangerous' | 'blocked'

export interface AppActionMeta {
  action: string
  title: string
  category: string
  risk: AppActionRisk
  description: string
  args?: Record<string, string>
  aliases?: string[]
  ui?: string
}

export const APP_ACTIONS: AppActionMeta[] = [
  { action: 'tool.list', title: '查看工具清单', category: 'system', risk: 'read', description: '列出小蜜/Agent 当前可用的界面功能工具。' },
  { action: 'tool.schema', title: '查看工具说明', category: 'system', risk: 'read', description: '查看单个工具的参数、风险等级与界面来源。', args: { action: '工具名' }, aliases: ['tool.help'] },
  { action: 'app.call', title: '调用界面功能', category: 'system', risk: 'normal_write', description: '按 action + args 调用已登记的界面功能工具。', args: { action: '目标工具名', args: 'JSON 参数' } },
  { action: 'chat.list', title: '查看最近消息', category: 'chat', risk: 'read', description: '读取当前房间最近消息。', args: { limit: '数量' }, ui: '房间聊天' },
  { action: 'chat.send', title: '发送房间消息', category: 'chat', risk: 'normal_write', description: '以当前 Agent 发送房间消息。', args: { content: '消息内容' }, ui: '房间聊天' },
  { action: 'agent.my-list', title: '我的 Agent', category: 'agent', risk: 'read', description: '列出当前用户通讯录/市场可见 Agent。', ui: '通讯录 Agent' },
  { action: 'agent.room-list', title: '房间 Agent', category: 'agent', risk: 'read', description: '列出当前房间 Agent。', ui: '房间成员' },
  { action: 'agent.list-available', title: '可添加 Agent', category: 'agent', risk: 'read', description: '列出当前房间可添加的 Agent。', ui: '房间成员' },
  { action: 'agent.detail', title: 'Agent 详情', category: 'agent', risk: 'read', description: '查看有权限访问的 Agent 详情、技能和脚本摘要。', args: { agent: 'Agent 名称或 ID，可省略为当前 Agent' }, ui: 'Agent 设置' },
  { action: 'agent.update', title: '更新 Agent', category: 'agent', risk: 'normal_write', description: '修改当前用户可编辑 Agent 的名称、描述、专长、配置等。', args: { agent: 'Agent 名称或 ID', updates: '更新字段' }, ui: 'Agent 设置' },
  { action: 'agent.model.get', title: '查看 Agent 模型配置', category: 'agent', risk: 'read', description: '查看 Agent 生效模型、默认模型和房间覆盖。', args: { agent: 'Agent 名称或 ID' }, ui: 'Agent 模型设置' },
  { action: 'agent.model.update-default', title: '更新 Agent 默认模型', category: 'agent', risk: 'normal_write', description: '修改通讯录/root Agent 默认模型配置。', args: { agent: 'Agent 名称或 ID', modelProfileId: '模型配置 ID', model: '模型名' }, ui: 'Agent 模型设置' },
  { action: 'agent.room-model.update', title: '更新房间 Agent 模型覆盖', category: 'agent', risk: 'normal_write', description: '修改当前房间内 Agent 的模型覆盖，或恢复继承。', args: { agent: 'Agent 名称或 ID', inherit: 'true 恢复继承' }, ui: '房间 Agent 模型覆盖' },
  { action: 'agent.add', title: '添加 Agent 到房间', category: 'agent', risk: 'sensitive_write', description: '把可用 Agent 加入当前房间。', ui: '房间成员' },
  { action: 'agent.remove', title: '移除房间 Agent', category: 'agent', risk: 'sensitive_write', description: '从当前房间移除 Agent。', ui: '房间成员' },
  { action: 'agent.restart', title: '重启 Agent', category: 'agent', risk: 'sensitive_write', description: '软恢复或强制重启房间 Agent。', ui: '房间 Agent 管理' },
  { action: 'agent.create-request', title: '创建 Agent 确认卡', category: 'agent', risk: 'normal_write', description: '生成创建 Agent 的确认卡，确认后创建。', ui: '小蜜创建 Agent' },
  { action: 'agent.skill.list', title: 'Agent Skill 列表', category: 'agent', risk: 'read', description: '查看 Agent Skill。', ui: 'Agent 能力' },
  { action: 'agent.script.list', title: 'Agent Script 列表', category: 'agent', risk: 'read', description: '查看 Agent Script。', ui: 'Agent 能力' },
  { action: 'agent.knowledge.list', title: 'Agent 知识库列表', category: 'knowledge', risk: 'read', description: '列出有权限访问的 Agent 知识库文件。', ui: 'Agent 知识库' },
  { action: 'agent.knowledge.search', title: '搜索 Agent 知识库', category: 'knowledge', risk: 'read', description: '搜索 Agent 自有知识和通用公共知识。', args: { agent: 'Agent 名称或 ID', query: '关键词' }, ui: 'Agent 知识库' },
  { action: 'agent.knowledge.read', title: '读取 Agent 知识文件', category: 'knowledge', risk: 'read', description: '读取 Agent 知识文件或 public:<entryId> 公共知识。', args: { agent: 'Agent 名称或 ID', ref: '文件 id/path/name 或 public:<entryId>' }, ui: 'Agent 知识库' },
  { action: 'agent.knowledge.upsert', title: '写入 Agent 知识文件', category: 'knowledge', risk: 'normal_write', description: '新建或覆盖 Agent 知识文件。', args: { agent: 'Agent 名称或 ID', path: '路径', content: '文本内容' }, ui: 'Agent 知识库' },
  { action: 'agent.knowledge.delete', title: '删除 Agent 知识文件', category: 'knowledge', risk: 'sensitive_write', description: '删除 Agent 知识文件。', args: { agent: 'Agent 名称或 ID', fileId: '文件 id' }, ui: 'Agent 知识库' },
  { action: 'agent.knowledge.reindex', title: '重建 Agent 知识索引', category: 'knowledge', risk: 'normal_write', description: '标记/重建 Agent 知识索引。', ui: 'Agent 知识库' },
  { action: 'billing.account', title: '查看余额', category: 'billing', risk: 'read', description: '查看当前用户余额与收入余额。', ui: '账单中心' },
  { action: 'billing.summary', title: '账单汇总', category: 'billing', risk: 'read', description: '查看当前用户用量/费用汇总与多维度统计。', ui: '账单中心' },
  { action: 'billing.ledger', title: '账单明细', category: 'billing', risk: 'read', description: '查看当前用户账单流水。', ui: '账单中心' },
  { action: 'model.profile.list', title: '模型配置列表', category: 'model', risk: 'read', description: '查看当前用户可见模型配置。', ui: '模型配置' },
  { action: 'room.info', title: '房间信息', category: 'room', risk: 'read', description: '查看当前房间信息。', ui: '房间设置' },
  { action: 'room.update', title: '修改房间', category: 'room', risk: 'sensitive_write', description: '修改当前房间名称/描述。', ui: '房间设置' },
  { action: 'room.create-invite', title: '创建邀请链接', category: 'room', risk: 'sensitive_write', description: '创建当前房间邀请链接。', ui: '房间成员' },
  { action: 'members.list', title: '成员列表', category: 'room', risk: 'read', description: '查看当前房间成员和 Agent。', ui: '房间成员' },
  { action: 'members.add', title: '添加成员', category: 'room', risk: 'sensitive_write', description: '添加成员到当前房间。', ui: '房间成员' },
  { action: 'file.list', title: '文件列表', category: 'file', risk: 'read', description: '查看项目文件树。', ui: '文件面板' },
  { action: 'file.read', title: '读取文件', category: 'file', risk: 'read', description: '读取项目文本文件。', ui: '文件面板' },
  { action: 'file.write', title: '写入文件', category: 'file', risk: 'normal_write', description: '写入项目文件。', ui: '文件面板' },
  { action: 'file.delete', title: '删除文件', category: 'file', risk: 'sensitive_write', description: '删除项目文件。', ui: '文件面板' },
  { action: 'task.list', title: '任务列表', category: 'task', risk: 'read', description: '查看任务。', ui: '任务面板' },
  { action: 'task.create', title: '创建任务', category: 'task', risk: 'normal_write', description: '创建任务。', ui: '任务面板' },
  { action: 'task.update', title: '更新任务', category: 'task', risk: 'normal_write', description: '更新任务字段。', ui: '任务面板' },
]

const byAction = new Map<string, AppActionMeta>()
for (const item of APP_ACTIONS) {
  byAction.set(item.action, item)
  for (const alias of item.aliases || []) byAction.set(alias, { ...item, action: alias })
}

export function listAppActions(category?: string) {
  return APP_ACTIONS.filter((item) => !category || item.category === category)
}

export function getAppAction(action: string) {
  return byAction.get(action)
}

export function isKnownAppAction(action: string) {
  return byAction.has(action)
}
