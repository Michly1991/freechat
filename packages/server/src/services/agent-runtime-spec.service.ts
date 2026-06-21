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

## 房间文件强控规则

- 用户可见文件必须通过 \`./freechat file ...\` 写回服务端。
- 禁止直接访问或修改 \`.freechat/workspace-data/rooms/<roomId>/files\`、\`../../files\` 或其他房间目录。
- 文件和目录均绑定当前 \`roomId\`；不同房间文件互相不可见。
- \`fileId\` 不是访问令牌；服务端必须按当前 \`roomId + fileId\` 校验后才允许下载、读取、promote 或搜索。
- 对话附件使用稳定引用 \`file:<fileId>\`，下载时优先使用：\`./freechat file download file:<fileId>\`。
- PDF、Excel、Word、图片、音视频等复杂文件由 Agent Client 下载到本地处理，服务端只做基础存取、权限、审计和广播。
- 处理完成后必须用 \`./freechat file upload\`、\`./freechat file write-local\` 或 \`./freechat file promote\` 写回当前房间。

## 交付物规则

- 群聊/项目交付文件不能只留在本地工作区；必须通过 FreeChat CLI 写回房间文件体系。
- 如需在文件 Tab 显示，加 \`--show\` 或执行 \`./freechat file show <path>\`。
- 如需发布用户可见页面，使用 \`./freechat tab create-local/update-local\`。

## Agent 协作规则

- 普通聊天中不要假 \`@另一个Agent\` 试图触发对方。
- 客服/接待转交使用 \`./freechat room handoff --agent <名称> --reason <原因>\`。
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
    const claudeMd = `# FreeChat Agent Client\n\n你运行在用户自己的 Agent Client 中。\n\n启动后必须阅读并遵守：\n\n- .freechat/RUNTIME.md：服务端统一运行规范和强制规则\n- .freechat/API.md：FreeChat CLI/API 使用说明\n\n关键要求：\n\n- 普通聊天/私聊：直接把最终回复输出到 stdout，Agent Client 会自动发回房间；不要再调用 ./freechat chat send，避免重复回复。\n- 需要中途汇报、多条消息或执行工具时，才使用 ./freechat chat send <内容> 或 ./freechat tool <action> '<jsonArgs>'。\n- 用户可见文件必须通过 ./freechat file ... 写回当前房间，不能只留在本地 res/。\n- 对话附件优先使用 file:<fileId> 引用并通过 ./freechat file download file:<fileId> 下载。\n- 如果需要把当前接待/助理转给房间内另一个 Agent，使用 ./freechat room handoff --agent <名称> --reason <原因>，不要普通聊天里假 @。\n`
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
