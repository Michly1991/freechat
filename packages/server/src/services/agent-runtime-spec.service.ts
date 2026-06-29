import { createHash } from 'crypto'
import { renderAgentApiDoc } from './agent-workspace-template.js'
import { renderAgentCliCjs, renderAgentCliWrapper } from './agent-cli-template.js'

const RUNTIME_RULES = `# FreeChat Agent Runtime Spec

这是服务端下发给 Agent Client 的统一运行规范。客户端每次执行 Agent 前应使用最新规范生成工作区文件，子 Agent 不应各自维护过期 CLI 或文件规则。

## 核心原则

- FreeChat Server 是房间、文件、任务、计费、权限和审计的唯一裁决者。
- Agent Client 只负责本地执行模型和工具调用；不要绕过服务端直接读写房间文件。
- 当前工作目录是 Agent 私有工作区，不是房间文件区。
- 本地 \`res/\`、\`scripts/\`、\`skills/\` 只用于草稿、脚本、缓存和中间产物。

## 界面功能代操作规则

- 用户要求“帮我在界面里查/改/设置/管理”时，优先用 \`./freechat app list\`、\`./freechat app help <action>\`、\`./freechat app call <action> '<jsonArgs>'\`。
- \`app.call\` 覆盖界面主要功能：Agent 管理、Agent 知识库、账单查询、模型配置列表、房间/成员/文件/任务等。
- 小蜜和 Agent CLI 都必须走服务端 App Action 权限校验；不要直接绕过界面规则访问内部 REST API。
- 查询类可直接执行；删除、成员角色、邀请、敏感配置等高风险操作应先生成确认卡或要求明确确认。

## 房间文件强控规则

- 用户可见文件必须通过 \`./freechat file ...\` 写回服务端。
- 禁止直接访问或修改 \`.freechat/workspace-data/rooms/<roomId>/files\`、\`../../files\` 或其他房间目录。
- 文件和目录均绑定当前 \`roomId\`；不同房间文件互相不可见。
- \`fileId\` 不是访问令牌；服务端必须按当前 \`roomId + fileId\` 校验后才允许下载、读取、promote 或搜索。
- 对话附件使用稳定引用 \`file:<fileId>\`。服务端只提供文件上传、下载、存储、权限和审计基础能力，不做 PDF/Excel/Word/PPT/图片解析或生成。
- 读取/分析附件：文本小文件可用 \`file.read\`；PDF、Excel、Word、PPT、图片等复杂文件必须先执行 \`./freechat file download file:<fileId> [localPath]\` 下载到 Agent Client 本地，再用本地脚本、Skill 或系统工具处理。
- 生成/修改复杂文件：Agent Client 在本地生成后，用 \`./freechat file upload <localPath> <projectPath> --show\` 或 \`./freechat file write-local <projectPath> <localPath> --show\` 写回当前房间。

## 交付物规则

- 群聊/项目交付文件不能只留在本地工作区；必须通过 FreeChat CLI 写回房间文件体系。
- 如需在文件 Tab 显示，加 \`--show\` 或执行 \`./freechat file show <path>\`。
- 如需发布用户可见页面，使用 \`./freechat tab create-local/update-local\`。

## 页面 Tab 工具规则

- 页面 Tab 的查询、创建、更新、局部修改和受控操作都必须通过 \`./freechat tab ...\`。
- 先用 \`./freechat tab list/get/search\` 查询现有页面，再决定创建还是修改。
- 大页面先写本地 HTML 文件，再用 \`./freechat tab create-local\` 或 \`update-local\` 发布。
- 页面需要后续局部修改时，为关键区域增加 \`id\` 或 \`data-freechat-id\`。
- 页面操作只支持受控动作：\`open\`、\`scrollTo\`、\`highlight\`；不要要求执行任意浏览器 JS。

## 知识库规则

- FreeChat Server 是房间知识、Agent 自有知识库与通用公共知识的主存储；Agent Client 运行时只按当前房间权限按需检索/读取。
- 不要把知识库全文预先复制进上下文；遇到产品规则、专业资料、长期背景、房间/客户资料、用户上传给 Agent 的知识或不确定答案时，先用 \`./freechat knowledge search <query>\`。
- 检索范围自动包含：当前房间知识库、当前 Agent 专属知识库、通用公共知识库。
- 检索命中后只读取少量相关条目：\`./freechat knowledge read <room:entryId|agent:fileId|agent-entry:entryId|public:entryId>\`。
- 优先级：房间知识 > Agent 自有知识 > 通用公共知识；如果知识和最近对话冲突，先向用户确认。
- Agent 自有知识按 root Agent 继承，房间 clone/materialize 的 Agent 默认使用通讯录 Agent 的知识库。
- 不要跨房间读取房间知识；服务端会校验当前 Agent 必须在目标房间内。

## Agent 协作规则

- 普通聊天中不要假 \`@另一个Agent\` 试图触发对方。
- 用户要求“切到/切换到/转接给/换成/让某 Agent 协调”时，当前协调者 Agent 必须显式调用 \`./freechat room handoff --agent <名称> --reason <原因>\`。
- 没有 handoff 工具成功结果前，禁止说“已切换/已转接/我是目标 Agent”，也禁止冒充目标 Agent 回复。
- 项目协作使用 \`./freechat task create/subtask add --assignee <Agent名称>\`。
- 简单单 Agent 任务直接完成；复杂、长期、跨 Agent 的事项再创建任务。
`

export interface AgentRuntimeSpec {
  version: string
  updatedAt: number
  checksum: string
  cliWrapper: string
  cliCjsTemplate: string
  claudeMd: string
  apiDoc: string
  runtimeRules: string
}

class AgentRuntimeSpecService {
  private cached?: AgentRuntimeSpec

  getSpec(): AgentRuntimeSpec {
    const cliCjsTemplate = renderAgentCliCjs({
      apiUrl: '__FREECHAT_API_URL__',
      roomId: '__FREECHAT_ROOM_ID__',
      token: '__FREECHAT_TOKEN__',
    })
    const cliWrapper = renderAgentCliWrapper()
    const apiDoc = renderAgentApiDoc()
    const claudeMd = `# FreeChat Agent Client\n\n你运行在用户自己的 Agent Client 中。\n\n启动后必须阅读并遵守：\n\n- .freechat/RUNTIME.md：服务端统一运行规范和强制规则\n- .freechat/API.md：FreeChat CLI/API 使用说明\n\n关键要求：\n\n- 普通聊天/私聊：直接把最终回复输出到 stdout，Agent Client 会自动发回房间；不要再调用 ./freechat chat send，避免重复回复。\n- 需要读取/查询/写入文件或调用应用能力时，必须使用 ./freechat tool call <action> '<jsonArgs>' 或对应 CLI 命令；不要输出 <toolcall>...</toolcall>、接口 JSON、API 参数给用户。\n- 需要中途汇报、多条消息或执行工具时，才使用 ./freechat chat send <内容> 或 ./freechat tool <action> '<jsonArgs>'。\n- 用户可见文件必须通过 ./freechat file ... 写回当前房间，不能只留在本地 res/。\n- 对话附件优先使用 file:<fileId> 引用；文本小文件可用 ./freechat file read；PDF/Excel/Word/PPT/图片等复杂文件必须先用 ./freechat file download file:<fileId> 下载到 Agent Client 本地，再用本地脚本/Skill/工具处理；服务端不做文件解析或生成。\n- 如果需要把当前协调者转给房间内另一个 Agent，使用 ./freechat room handoff --agent <名称> --reason <原因>，不要普通聊天里假 @。\n`
    const material = JSON.stringify({ cliCjsTemplate, cliWrapper, claudeMd, apiDoc, runtimeRules: RUNTIME_RULES })
    const checksum = createHash('sha256').update(material).digest('hex')
    if (this.cached?.checksum === checksum) return this.cached
    this.cached = {
      version: `runtime-${checksum.slice(0, 12)}`,
      updatedAt: Date.now(),
      checksum,
      cliWrapper,
      cliCjsTemplate,
      claudeMd,
      apiDoc,
      runtimeRules: RUNTIME_RULES,
    }
    return this.cached
  }
}

export const agentRuntimeSpecService = new AgentRuntimeSpecService()
