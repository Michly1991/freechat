# Agent 运行时与 CLI 实现补充

> 从 DESIGN-AGENT 拆分出的运行时、工作区、CLI、Tab API、资源保护等实现细节。

## 当前实现补充：默认助理与 Agent 可见性

### 1. 默认助理 Agent 的创建时机

默认助理不再依赖用户手动添加。创建房间时，服务端自动创建一个 `assistant` 类型 Agent，并绑定到当前房间。

默认配置：

```json
{
  "name": "助理",
  "roleType": "assistant",
  "deployment": "server",
  "status": "active",
  "specialties": ["协作", "总结", "任务协调", "决策"],
  "config": {
    "defaultRoomAssistant": true,
    "roomId": "room_xxx"
  }
}
```

### 2. 默认助理生命周期

默认助理与房间生命周期绑定：

- 房间创建：自动创建默认助理
- 房间删除：自动删除该房间的默认助理
- 手动添加的专家 Agent：不随房间删除，只解除 room-agent 绑定

### 3. Agent 在线状态展示

Agent 必须在房间成员面板和 `@` 提及面板中可见。

| 状态 | 含义 | 前端展示 |
| --- | --- | --- |
| `active` | 可调用 | 在线 / 绿色点 |
| `working` | 执行中 | 工作中 / 黄色点 |
| `inactive` | 不可用 | 离线 / 灰色点 |

### 4. @Agent 调用入口

用户输入 `@` 时，前端候选面板同时列出人类成员和 Agent。选中 Agent 后将 Agent 名称插入消息输入框，发送后由后端根据 mentions 或文本中的 `@AgentName` 进行后续路由。

约束：

- 用户不能 @ 自己
- Agent 候选需要显示在线状态
- 中文 Agent 名称必须可搜索和插入

### 5. 当前 Claude Code CLI / 模型路由

当前本地 Claude Code CLI 已调通，版本：

```bash
claude --version
# 2.1.168 (Claude Code)
```

当前可用模型走本地 Anthropic 兼容路由：

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:1572
ANTHROPIC_MODEL=minimax-m2.5
```

验证命令：

```bash
claude -p "回复一个字：好"
# 好
```

注意：后端 Agent 调用 Claude Code CLI 时，默认不要强制指定已不可用的 `qwen3.7-max`；应优先走当前环境默认模型 `minimax-m2.5`。

## @Agent 自动触发机制（2026-06-08）

房间聊天支持通过 `@Agent名称` 触发房间内 Agent 工作：

- 前端在 @ 弹层选择成员/Agent 时，会记录 `mentions` 元数据：`{ id, name, role }`。
- 发送消息时，前端会根据消息内容补全仍然存在的 mentions；即使用户手动输入 `@助理`，也会尝试匹配房间 Agent 并带上 mention。
- WebSocket `chat.send` payload 包含：

```json
{
  "content": "@助理 帮我看看",
  "mentions": [{ "id": "agent_xxx", "name": "助理", "role": "ai" }]
}
```

- 后端 `chat.send` 先保存并广播用户消息，再异步检查 `role=ai` 的 mentions。
- 只有当前房间已绑定的 Agent 才会被触发。
- Agent 触发时广播 `agent.status_update: working`，完成或失败后广播 `agent.status_update: active`。
- Agent 有回复时，后端创建 AI 消息并通过 WebSocket 广播 `chat.message`，所有在线成员实时可见。
- 同一条消息中同一 Agent 只触发一次。

## 服务端 Agent 默认运行时：Claude Code CLI（2026-06-08）

服务端部署的 Agent 默认通过 Claude Code CLI 执行。每次需要响应时，后端临时启动一个 `claude -p` 进程；进程执行完退出，但 `(roomId, agentId)` 会保存独立 `session_id`，下次同一个 Agent 在同一个房间响应时使用 `--resume <session_id>` 续接上下文。

### Agent 私有工作区隔离

Claude Code 不再运行在房间项目根目录，而是运行在每个 Agent 自己的私有目录：

```text
workspace-data/<roomId>/agents/<agentId>/
  AGENT.md              # Agent 自我介绍、角色、强制规则
  CLAUDE.md             # Claude Code 启动时读取的规则入口
  freechat              # 本 Agent 的 API CLI
  skills/               # Agent 自己的技能/模板/方法论
  res/                  # Agent 自己的资源、草稿、缓存、中间产物
  scripts/              # Agent 自己的脚本
  .freechat/
    ROOM.md
    MEMBERS.md
    API.md
```

用户可见项目文件区仍然只有：

```text
workspace-data/<roomId>/files/
```

前端文件 Tab、上传/删除接口、Agent Tool API 的 `file.list/read/write` 都只操作这个 `files/` 目录。

### 强制文件规则

- Agent 私有草稿、脚本、技能、资源只能写在自己的 `res/`、`scripts/`、`skills/`。
- 任何需要出现在页面“文件”Tab 的成果，必须调用：

```bash
./freechat file write <path> <content>
```

- 读取用户项目文件也必须调用：

```bash
./freechat file list
./freechat file read <path>
```

- Agent 不得直接访问或写入 `../../files`；即使文件系统可达，也视为越权。
- 不再提供“误写自动搬运到 files/”兜底。Agent 写在私有工作区的文件就是 Agent 内部文件，不会自动进入用户项目目录。

### 启动方式

当前 Claude Code CLI 不支持 `--cwd` 参数。服务端必须通过 Node `spawn` 设置 cwd：

```ts
spawn('claude', args, { cwd: agentWorkspaceDir })
```

启动参数包含：

```bash
claude -p "<用户消息>" \
  --permission-mode auto \
  --allowedTools 'Bash(./freechat *)' \
  --output-format json
```

如果存在历史会话，则追加：

```bash
--resume <session_id>
```

如果历史 `--resume` session 不存在，则自动去掉 `--resume` 重新启动一次，避免旧失败 session 阻塞 Agent 回复。

运行时配置：

```env
AGENT_RUNTIME=claude-code
```

可选值：

- `claude-code`：默认，服务端 Agent 以私有 Agent 工作区为 cwd 启动 Claude Code。
- `provider-api`：可选兼容模式，优先走配置的模型 Provider API，失败后 fallback 到 Claude Code。

## FreeChat Agent CLI 工具（2026-06-08）

Agent 工具层采用 CLI 方案。每次服务端启动 Claude Code 前，会在 Agent 私有工作区根目录生成可执行文件：

```text
workspace-data/<roomId>/agents/<agentId>/freechat
```

Claude Code 的 cwd 即为 Agent 私有工作区，所以 Agent 可以直接使用：

```bash
./freechat chat send "我开始处理"
./freechat task list
./freechat task create "任务标题" "任务说明"
./freechat task update <taskId> status doing
./freechat task update <taskId> status review reviewNote "已完成，等待确认"
./freechat task update <taskId> status done
./freechat file list
./freechat file read docs/example.md
./freechat file write docs/progress.md "进度内容"
./freechat members list
./freechat room info
```

服务端 Agent Tool API：

```text
POST /api/agent-tools/:roomId
```

该接口不使用用户 JWT，而使用服务端为当前 Agent + Room 生成的本地工具 token。CLI 内置该 token，并调用本机服务端 API。服务端收到工具调用后直接操作内部 service：

- `chat.send` → `messageService.createMessage` 并广播 `chat.message`
- `task.list/create/update` → `taskService` 并广播 `task.changed`
- `file.list/read/write` → 房间 `files/` 项目文件区，并广播 `files.updated`
- `members.list` → 房间成员 + Agent 列表
- `room.info` → 当前房间信息

Agent 行为规范：复杂任务必须先用 `chat send` 汇报开始，然后通过 `task create/update` 同步进度，必要时使用 `file read/write` 读写项目资料，完成后再发送总结。

### Agent 在线状态显示

房间 Agent API 返回状态字段：

```ts
status: 'active' | 'working' | 'inactive' | 'error'
onlineStatus: 'online' | 'working' | 'offline' | 'error'
lastActiveAt?: number
lastError?: string
```

含义：

- `online`：服务端 Agent 可被调度；当前 Claude Code 不常驻，但后端可随时启动它。
- `working`：正在执行一次 Claude Code 调用。
- `offline`：Agent 被停用或未来客户端 Agent 心跳断开。
- `error`：上次执行失败，需要用户看到异常而不是误以为无响应。

WebSocket 广播 `agent.status_update` 必须携带 `status / onlineStatus / lastActiveAt / lastError`，前端房间顶部、成员面板、@ 提及弹层和 Agent 资料弹窗都要实时显示在线/工作中/离线/异常。

## 助理智能旁听自动回复（2026-06-08）

房间默认助理支持“智能旁听”：用户不必每次 `@助理`，后端会根据消息内容和上下文判断是否触发助理。

触发链路：

1. `chat.send` 保存并广播用户消息。
2. 如果消息明确 `@Agent`，立即触发指定 Agent，不受自动回复冷却影响。
3. 如果没有 `@Agent` 且发送者是人类用户，则进入智能旁听判断。
4. 规则过滤明显不需要回复的内容，如“好的/收到/哈哈/1/测试”等短消息。
5. 对疑似需要协助的消息触发默认助理，附带最近 10 条上下文，并要求助理自行判断：
   - 不需要回复时输出 `[SILENT]`。
   - 需要回复时简洁介入。
   - 如需推进项目，优先使用 `./freechat` CLI 同步任务、进度和文件。
6. 同一房间自动回复有 30 秒冷却，避免刷屏。
7. Agent 自己发出的消息不会触发自动旁听，避免循环。

第一版触发关键词包括：问号、帮我、怎么、如何、为什么、下一步、总结、安排、任务、卡住、阻塞、方案、决定、谁来、处理、实现、优化、修复、设计、评估、建议等。

### 自动旁听触发规则调整

自动旁听第一版的关键词规则过窄，导致“我不@它，它不回复我”这类反馈/抱怨消息不会进入助理判断。现在规则调整为：

- 只过滤明显无意义或确认类短消息，例如“好/好的/收到/嗯/哈哈/1/测试/谢谢”等。
- 其他非短消息都交给助理结合最近上下文判断是否回复。
- 助理如果判断不需要回复，仍输出 `[SILENT]` 保持安静。

这样减少规则漏判，让“是否接话”的判断主要由助理模型结合上下文完成。

## Agent Tool：动态 Tab 界面 API

Agent 可以通过私有工作区根目录的 `./freechat` CLI 创建和维护房间里的“标签”界面。标签内容是 HTML 字符串，由前端以 iframe sandbox 渲染。

### Agent Tool Actions

```text
tab.list
tab.create
tab.create-from-file
tab.update
tab.delete
tab.reorder
```

### CLI 用法

```bash
./freechat tab list
./freechat tab create "数据看板" "<html>...</html>"
./freechat tab create-from-file "数据看板" ui/dashboard.html
./freechat tab update <tabId> "<html>...</html>"
./freechat tab update-from-file <tabId> ui/dashboard.html
./freechat tab delete <tabId>
./freechat tab reorder <tabId> [tabId...]
```

### 推荐工作流

推荐 Agent 先通过文件 API 写入 HTML 文件，再从文件创建/更新 Tab：

```bash
./freechat file write ui/dashboard.html "<html>...</html>"
./freechat tab create-from-file "数据看板" ui/dashboard.html
```

原因：

- HTML 内容会留存在项目文件区，便于审计和后续修改。
- Tab 创建/更新仍通过受控 API 完成，避免 Agent 直接改数据库。
- 前端收到 `tabs.updated` 广播后刷新标签列表。

### 权限边界

- Agent 不能直接访问或修改数据库。
- Agent 不能直接写 `workspace-data/{roomId}/files`，必须通过 `./freechat file write`。
- Agent 创建的 Tab 会记录 `created_by = agent.id`。
- Tab 的展示内容仍受 iframe sandbox 约束。

### 已补充实现细节

- 用户侧 Tab API 增加房间成员校验：非成员禁止访问；viewer 只读；editor/owner 可创建、修改、删除、排序。
- 用户侧 Tab API 对不存在的 `tabId` 返回 `TAB_NOT_FOUND`，避免静默成功。
- Agent Tool 的 `tab.update/delete/reorder` 对不存在的 Tab 返回 `TAB_NOT_FOUND`。
- Agent Tool 的 `tab.reorder` 会校验所有 `tabIds` 必须属于当前房间。
- Agent CLI 增加本地文件入口：

```bash
./freechat tab create-from-local "数据看板" res/dashboard.html
./freechat tab update-from-local <tabId> res/dashboard.html
```

`*-from-local` 由 CLI 在 Agent 私有工作区本地读取文件内容，再调用受控 Agent Tool API；后端不会直接读取 Agent 私有文件。

## Agent CLI 设计优化（可用性）

为降低 Agent 使用 Shell 参数传大段内容时的失败率，CLI 提供“本地文件读取”命令。CLI 在 Agent 私有工作区本地读取文件内容，再调用受控 Agent Tool API；后端仍只接受 API 请求，不直接访问 Agent 私有文件。

### 文件命令优化

```bash
./freechat file write <projectPath> <content> [--show|--hide]
./freechat file write-local <projectPath> <localPath> [--show|--hide]
./freechat file show <projectPath> [tabKey]
./freechat file hide <projectPath> [tabKey]
```

- `--show`：写入项目文件后加入文件 Tab 配置。
- `--hide`：只写项目文件，不加入文件 Tab。
- `write-local`：从 Agent 私有工作区本地文件读取内容，适合 Markdown/HTML 等长内容。

### Tab 命令别名优化

推荐短命令：

```bash
./freechat tab create-local "数据看板" res/dashboard.html
./freechat tab update-local <tabId> res/dashboard.html
./freechat tab create-file "数据看板" ui/dashboard.html
./freechat tab update-file <tabId> ui/dashboard.html
```

兼容旧别名：

```bash
./freechat tab create-from-local "数据看板" res/dashboard.html
./freechat tab update-from-local <tabId> res/dashboard.html
./freechat tab create-from-file "数据看板" ui/dashboard.html
./freechat tab update-from-file <tabId> ui/dashboard.html
```

### 推荐发布流程

1. Agent 在私有工作区生成草稿：`res/dashboard.html`。
2. 用 `tab create-local/update-local` 发布成用户可见界面。
3. 如果该 HTML 也是项目交付物，再用 `file write-local ui/dashboard.html res/dashboard.html --show` 留档并显示在文件 Tab。

这样能同时满足：

- Agent 私有中间产物不污染用户项目文件。
- 用户可见界面通过受控 API 发布。
- 需要留档的 HTML 可以明确进入项目文件区和文件 Tab。

## Agent 资源保护与清理

Server-side Agent 不是常驻 Claude 进程，而是按需启动 Claude Code 子进程。为避免异常情况下资源泄漏，服务端增加以下保护：

### Claude Code Watchdog

配置项：

```env
AGENT_TIMEOUT_MS=120000
AGENT_KILL_GRACE_MS=5000
```

行为：

1. 启动 Claude Code 后设置 watchdog。
2. 超过 `AGENT_TIMEOUT_MS` 未退出，先发送 `SIGTERM`。
3. 等待 `AGENT_KILL_GRACE_MS` 后仍未退出，再发送 `SIGKILL`。
4. 返回 `AGENT_TIMEOUT` 错误，并保留最后一段 stdout/stderr 作为排障信息。
5. stdout/stderr 在内存中最多保留最近 1MB，避免异常输出撑爆服务端内存。

### Agent History 清理

配置项：

```env
AGENT_HISTORY_LIMIT=100
AGENT_SESSION_RETENTION_DAYS=30
```

行为：

- 每个 Claude session 的 `agent_messages` 最多保留最近 `AGENT_HISTORY_LIMIT` 条。
- 超过 `AGENT_SESSION_RETENTION_DAYS` 未活跃的 `agent_sessions` 和对应 `agent_messages` 会被清理。

这保证 Agent 多轮调用不会无限增长数据库历史，也避免卡死的 Claude Code 子进程长期占用内存。

### Agent Run 可观测性

服务端为每次 Agent 调用记录 `agent_runs`：

```sql
agent_runs (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,       -- running / succeeded / failed / cancelled
  input TEXT NOT NULL,
  output TEXT,
  error TEXT,
  session_id TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
)
```

调用开始时写入 `running`，成功、静默成功、重试成功或失败时更新终态。这样后续可以在前端展示 Agent 执行历史，也能排查 CLI 超时、session 损坏、模型配置错误等问题。

## 默认助理唯一性约束（2026-06-15）

每个房间只能有一个真正的默认助理：`room_role='assistant'` 且 `auto_enabled=1` 的房间内 Agent 副本。

约束：

- 全局内置默认助理模板（`config.builtInKey='default_assistant'`）不能作为普通 specialist 直接出现在房间里。
- 当房间已经有默认助理时，再添加内置默认助理模板应被后端忽略，避免 @ 候选出现两个“助理”。
- `getRoomAgents` 会对历史脏数据做兜底过滤：若已有主默认助理，则隐藏同名的内置默认助理模板/specialist。
- 前端 @ 候选和成员面板也会基于 `visibleRoomAgents` 做同名助理去重兜底，优先展示 `autoEnabled` 的房间默认助理。

## Agent 工作目录规范更新（2026-06-16）

FreeChat 运行时目录统一到仓库根 `.freechat/` 后，Agent 运行环境遵循：

- Agent cwd：`.freechat/workspace-data/<roomId>/agents/<agentId>/`
- 房间项目文件：`.freechat/workspace-data/<roomId>/files/`
- 房间上下文：Agent cwd 下的 `.freechat/`，以及房间目录下的 `.freechat/`

Agent 提示词、`AGENT.md`、`CLAUDE.md`、`.freechat/API.md` 和内置 Skill 均应强调：项目文件只能通过 `./freechat` CLI/API 读写；不要直接访问 `../../files` 或任何 `.freechat/workspace-data/<roomId>/files` 实体路径。

## Agent 上下文瘦身与会话轮换（2026-06-16）

Claude Code 自身会做上下文管理，但 FreeChat 不依赖模型侧兜底。Agent runtime 会主动控制长会话：

- `AGENT_SESSION_MAX_RUNS`：默认 30，单个 Agent session 超过运行次数后不再 `--resume`。
- `AGENT_SESSION_MAX_AGE_HOURS`：默认 24，超过年龄后不再 `--resume`。
- `AGENT_HISTORY_LIMIT`：provider-api 历史默认 80。
- `AGENT_CHAT_RECENT_DEFAULT_LIMIT`：Agent `chat recent` 默认 30，显式 limit 最大 200。

当 Claude Code session 被轮换时，系统会在 Agent 工作区写入：

```text
.freechat/SESSION_SUMMARY.md
```

摘要包含最近运行的输入、输出摘要、错误和轮换原因。新会话应优先读取结构化上下文（`ROOM.md`、`MEMBERS.md`、`TAB_FILES.md`、`SESSION_SUMMARY.md`、dreamMemory）而不是依赖无限增长的旧 Claude session。

