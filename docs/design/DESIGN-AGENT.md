# Agent 系统设计

## 核心理念

**每个房间 = 一个文件夹 = 一个 Claude Code 工作空间**

所有 Agent 都是 Claude Code 实例，区别仅在 system prompt。每个房间独立运行一个 Claude Code，工作目录就是房间文件夹，能访问房间内所有信息。

```
/workspace-data/{RoomID}/          ← Claude Code 的 cwd
├── chat/          ← 聊天记录
├── files/         ← 项目文件
├── ui/            ← Tab HTML
├── tasks/         ← 任务数据
└── agents/        ← Agent 配置（prompt、角色）
```

---

## 1. 房间 Agent 体系

### 助理 Agent（Room Assistant）

每个房间创建时**自动启动**一个 Claude Code 实例作为助理。

**助理是房间里唯一的决策者**，其他 Agent 只能执行和建议，助理负责拍板。

```
角色：房间管家 / 项目经理 / 决策者

职责：
  1. 监听房间内所有人类消息
  2. 判断用户意图
  3. 简单问题直接回答
  4. 复杂任务 → 创建任务 → 分配给专业 Agent
  5. 跟踪任务进度，汇报结果
  6. 组织多 Agent 讨论，汇总结论
  7. 拍板决策

拍板规则：
  - 常规方案 → 助理直接拍板，分配任务执行
  - 重要方案（涉及架构/安全/产品方向）→ @用户 确认后拍板
  - 多 Agent 讨论后 → 助理汇总结论并拍板最终方案

与其他 Agent 的区别：
  - 专家 Agent 主要执行分配给自己的任务
  - 专家 Agent 可以创建任务（如拆分子任务），但会自动同步给助理
  - 专家 Agent 不能分配任务给别人，不能拍板方案
  - 专家 Agent 不能组织讨论
  - 只有助理有权分配工作、拍板方案

背后对接：Claude API
```

### 专业 Agent（Specialist）

助理通过 MCP 工具启动额外的 Claude Code 会话：

```
角色：由助理根据需求动态创建
system prompt：由助理生成，针对具体任务

示例：
  - "你是前端开发工程师，负责开发登录页面..."
  - "你是测试工程师，负责编写和运行测试..."
  - "你是文档工程师，负责编写 API 文档..."

每个专业 Agent 也是一个 Claude Code 会话（独立 session-id）
cwd 同样是 /workspace-data/{RoomID}/

助理通过 MCP 工具 spawn_specialist(prompt, task_description) 启动
专业 Agent 完成后通过 MCP 工具 report_completion(result) 回报
```

---

## 2. 协作流程

```
用户发消息："帮我做一个登录页面，写完跑下测试"
    │
    ▼
助理 Claude Code（始终运行，监听消息）
    │
    ├─ 判断意图 → 需要两个任务
    ├─ 发消息："好的，我来安排"
    ├─ 创建任务：
    │   ├─ task 1: "开发登录页面" → assignee: 代码Agent
    │   └─ task 2: "编写登录页测试" → assignee: 测试Agent
    │
    ├─ 启动代码 Agent Claude Code（system prompt: 前端开发）
    │   └─ 代码 Agent 发消息："收到，我来开发登录页面"
    │   └─ 读写文件，写代码...
    │   └─ 发消息："登录页面开发完成"
    │   └─ 更新任务状态 → done
    │   └─ 退出
    │
    ├─ 启动测试 Agent Claude Code（system prompt: 测试工程）
    │   └─ 测试 Agent 发消息："收到，我来写测试"
    │   └─ 写测试，跑测试...
    │   └─ 发消息："测试通过 ✅ 12/12"
    │   └─ 更新任务状态 → done
    │   └─ 退出
    │
    └─ 助理监听到两个任务都完成
        └─ 发消息："全部完成 ✅ 开发+测试都搞定了"
```

---

## 3. Claude Code CLI 对接方案

### Claude Code CLI 能力

```bash
# 单次执行（非交互，输出后退出）
claude -p "你的任务描述" --cwd /path/to/project

# 恢复会话（保持上下文）
claude -p "继续上次的任务" --resume <session-id>

# 指定模型
claude -p "任务" --model claude-3-5-sonnet

# MCP 配置（自定义工具）
claude -p "任务" --mcp-config /path/to/mcp.json
```

**关键特性：**
- `-p` 模式：非交互，执行完自动退出，适合服务端调用
- `--resume`：通过 session-id 保持会话上下文
- `--cwd`：指定工作目录（就是房间文件夹）
- 输出到 stdout，服务端捕获解析

### 架构

```
┌──────────────┐      WebSocket       ┌──────────────────┐
│  浏览器/客户端  │ ◄──────────────────► │  FreeChat 服务端  │
└──────────────┘                       └────────┬─────────┘
                                                │
                                    ┌───────────┼───────────┐
                                    │                       │
                              ┌─────▼─────┐          ┌─────▼─────┐
                              │ 房间 A    │          │ 房间 B    │
                              │ session:  │          │ session:  │
                              │ abc-123   │          │ def-456   │
                              └───────────┘          └───────────┘
                                    │
                              每次用户发消息：
                              claude -p "消息" --resume <session>
                              └─ 执行 ─ 输出 ─ 退出
```

**不是常驻进程，而是按需启动：**
- 每个房间维护一个 **session-id**（存在数据库）
- 用户发消息 → 服务端启动 `claude -p --resume <session-id>`
- Claude Code 执行任务、输出结果、自动退出
- 下次消息来时，用同一个 session-id 恢复上下文

### 服务端实现

```typescript
import { spawn } from 'child_process';

class ClaudeCodeBridge {
  // 存储每个房间的 session-id
  private sessions: Map<string, string> = new Map();

  async handleUserMessage(roomId: string, userMessage: string): Promise<string> {
    const roomDir = `/workspace-data/${roomId}`;
    const sessionId = this.sessions.get(roomId);

    // 构建 Claude Code 命令
    const args = [
      '-p', userMessage,
      '--cwd', roomDir,
      '--model', 'claude-3-5-sonnet-20241022'
    ];

    // 如果有 session-id，恢复会话
    if (sessionId) {
      args.push('--resume', sessionId);
    }

    // 启动 Claude Code 进程
    const claude = spawn('claude', args);

    // 捕获输出
    let output = '';
    claude.stdout.on('data', (data) => {
      output += data.toString();
      // 实时解析并广播到 WebSocket
      this.parseAndBroadcast(roomId, data.toString());
    });

    // 等待完成
    await new Promise((resolve) => claude.on('close', resolve));

    // 如果是首次执行，保存 session-id
    // （Claude Code 会在首次运行时输出 session-id）
    if (!sessionId) {
      const newSessionId = this.extractSessionId(output);
      this.sessions.set(roomId, newSessionId);
    }

    return output;
  }

  private parseAndBroadcast(roomId: string, chunk: string) {
    // 解析 Claude Code 的输出
    // 如果是 MCP tool 调用，执行对应操作并广播
    // 如果是普通文本，直接广播到聊天流
  }

  private extractSessionId(output: string): string {
    // 从首次输出中提取 session-id
    // Claude Code 会在启动时输出类似：Session ID: abc-123
    const match = output.match(/Session ID:\s*(\S+)/);
    return match ? match[1] : '';
  }
}
```

### MCP 配置（每个房间一个）

```json
// /workspace-data/{RoomID}/.claude/mcp.json
{
  "mcpServers": {
    "freechat": {
      "command": "node",
      "args": ["/app/mcp-server/freechat-mcp.js"],
      "env": {
        "ROOM_ID": "rm_abc123",
        "API_BASE": "http://localhost:3000/api"
      }
    }
  }
}
```

MCP Server 提供的工具：
- `send_message(content)` → 发消息到聊天流
- `create_task(title, assignee, priority)` → 创建任务
- `update_task(task_id, status)` → 更新任务
- `list_tasks()` → 查看任务列表
- `list_files()` → 查看文件列表
- `list_members()` → 查看房间成员

Claude Code 在执行任务时可以自然调用这些工具：
```
用户："帮我创建一个任务，优先级高，分配给张三"
Claude Code：调用 create_task tool → 任务创建成功 → 广播到聊天流
```

---

## 4. Claude Code 实例管理

### 助理 Agent（常驻）

```typescript
// 房间创建时启动助理
async function onRoomCreated(roomId: string) {
  const roomDir = `/workspace-data/${roomId}`;
  
  const assistant = await claudeBridge.start({
    cwd: roomDir,
    systemPrompt: ASSISTANT_SYSTEM_PROMPT,
    persistent: true,        // 常驻运行
    mcpTools: [
      'freechat_send_message',
      'freechat_create_task', 
      'freechat_update_task',
      'freechat_list_tasks',
      'freechat_list_files',
      'freechat_list_members'
    ],
    // 文件读写是 Claude Code 原生能力，不需要额外 tool
  });

  // 持续监听房间消息，注入给助理
  roomManager.onMessage(roomId, (msg) => {
    if (msg.actor.role === 'human') {
      assistant.injectMessage(msg.payload.content);
    }
  });
}
```

### 专业 Agent（按需）

```typescript
// 助理决定需要专业 Agent 时，创建临时实例
async function spawnSpecialist(roomId: string, task: Task) {
  const roomDir = `/workspace-data/${roomId}`;
  
  const specialist = await claudeBridge.start({
    cwd: roomDir,
    systemPrompt: task.specialist_prompt,  // 助先生成的 prompt
    persistent: false,          // 任务完成就退出
    mcpTools: [
      'freechat_send_message',
      'freechat_update_task',
      'freechat_list_files'
    ]
  });

  // 注入任务描述
  specialist.injectMessage(`你的任务是：${task.description}`);

  // 监听完成信号
  specialist.onComplete(() => {
    specialist.stop();
  });
}
```

### 实例生命周期

```
房间创建 → 助理 Claude Code 启动（常驻）
              │
用户发消息 → 助理判断意图
              │
    ├─ 简单问题 → 助理直接回复（Claude Code 输出 → 广播）
    │
    └─ 复杂任务 → 助理启动专业 Claude Code
                    │
                    ├─ 专业 CC 工作...（输出实时广播到聊天流）
                    ├─ 专业 CC 完成任务 → 退出
                    │
                    └─ 助理收到完成通知 → 汇报给用户

房间删除 → 助理 Claude Code 停止 → 清理所有资源
```

---

## 5. 数据库（简化）

因为所有 Agent 都是 Claude Code，不需要 agents 表了：

```sql
-- 房间 Agent 配置（轻量记录）
CREATE TABLE room_agents (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  name TEXT NOT NULL,              -- "AI助理" / "代码Agent"
  role_type TEXT NOT NULL,         -- assistant | specialist
  system_prompt TEXT NOT NULL,     -- Claude Code 的 system prompt
  status TEXT NOT NULL DEFAULT 'active',  -- active | working | idle | stopped
  process_id TEXT,                 -- 运行时进程标识
  created_by TEXT,                 -- 助先生成的专业 Agent 填 assistant
  created_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);
```

每个房间默认有一条 assistant 记录。专业 Agent 由助理动态创建，完成后可以保留记录也可以清理。

---

## 6. 房间文件夹即项目空间

```
/workspace-data/{RoomID}/
├── chat/
│   └── history.jsonl         ← 聊天记录（Claude Code 可读上下文）
├── files/
│   ├── src/                  ← 项目源代码
│   ├── docs/                 ← 文档
│   └── ...                   ← 任何项目文件
├── ui/
│   ├── manifest.json         ← Tab 注册表
│   └── tabs/                 ← Tab HTML（Claude Code 可生成）
├── tasks/
│   └── board.json            ← 任务数据（或直接用 DB）
├── agents/
│   ├── assistant.md          ← 助理的 system prompt 文件
│   └── configs/              ← 专业 Agent 的 prompt 模板
├── .freechat/
│   └── config.json           ← Claude Code 的 MCP 配置、房间元数据
└── CLAUDE.md                 ← Claude Code 的项目说明文件
                               (描述项目结构、约定、上下文)
```

### CLAUDE.md（每个房间自动生成）

```markdown
# 项目空间

这是 FreeChat 的一个项目房间。

## 目录结构
- chat/ - 聊天记录
- files/ - 项目文件
- ui/ - 动态 UI 面板
- tasks/ - 任务看板数据

## 工具
你可以使用以下 MCP 工具与项目成员协作：
- freechat_send_message: 发送消息到聊天流
- freechat_create_task: 创建任务
- freechat_update_task: 更新任务状态
- freechat_list_tasks: 查看当前任务
- freechat_list_files: 查看文件列表

## 规则
- 被@时或被分配任务时，主动回应
- 完成任务后更新任务状态并通知用户
- 文件操作限定在 files/ 目录内
```

---

## 7. 前端展示

### 房间成员列表

```
┌──────────────────────────┐
│ 成员 (4)                 │
│ 🤖 AI助理 (常驻)         │  ← 始终在线
│ 👤 张三 (owner)          │
│ 🤖 代码Agent (工作中...) │  ← 临时专业 Agent
│ 👤 李四 (editor)         │
└──────────────────────────┘
```

### Agent 工作流可视化

```
🤖 AI助理           14:30
──────────────────────────
好的，我来安排这个需求：
📋 任务1: 开发登录页面 → 代码Agent
📋 任务2: 编写测试 → 测试Agent

🤖 代码Agent        14:30
──────────────────────────
⚙️ 收到，我来开发登录页面
   正在分析需求...

🤖 代码Agent        14:33
──────────────────────────
✅ 登录页面开发完成
  - files/src/login.tsx
  - files/src/login.css
  可在"面板" Tab 预览

🤖 AI助理           14:35
──────────────────────────
✅ 全部完成！
  - 开发 ✅ 代码Agent
  - 测试 ✅ 测试Agent (12/12 pass)
```

---

## 8. REST API（简化）

```typescript
// 获取房间的 Agent 列表
GET /api/rooms/:id/agents
Response: { 
  assistant: { name, status, system_prompt },
  specialists: [{ name, status, task, system_prompt }]
}

// 修改助理的 system prompt（用户自定义助理性格/能力）
PATCH /api/rooms/:id/assistant
Body: { system_prompt?: string }
Response: { success: true }

// 手动启动一个专业 Agent（用户主动要求）
POST /api/rooms/:id/agents
Body: { name: string, system_prompt: string, task: string }
Response: { agent_id: string }

// 停止一个专业 Agent
DELETE /api/rooms/:id/agents/:agentId
Response: { success: true }
```

---

## 9. 开发阶段

### Phase 1（MVP）
- [ ] 房间创建时自动启动助理 Claude Code
- [ ] 助理监听消息 → 直接回答简单问题
- [ ] 助理创建任务 → 任务在聊天和看板同步展示
- [ ] MCP Tools：send_message, create_task, update_task

### Phase 2
- [ ] 助理动态启动专业 Claude Code
- [ ] 专业 Agent 执行任务 → 输出实时广播
- [ ] 专业 Agent 完成任务自动退出

### Phase 3
- [ ] 用户自定义助理 prompt
- [ ] Agent 工作流可视化
- [ ] 专业 Agent 模板（代码/测试/文档等预设角色）

### Phase 4
- [ ] Agent 主动行为（定时汇报、异常检测）
- [ ] Agent 记忆（跨会话上下文持久化）
- [ ] 多 Agent 并行工作

---

## 10. 待确定

1. **Claude Code 的启动方式**：CLI（`claude --cwd ...`）？SDK？Subprocess？
2. **Claude Code 的会话管理**：常驻进程怎么保持上下文？用 `--resume` 还是始终保持 stdin 管道？
3. **并发控制**：多个专业 Agent 同时写同一个文件怎么办？（建议：助理在分配任务时避免文件冲突）

---

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

## 业务自定义 Agent 与多 Agent 规则

业务用户可以创建自己的 Agent，并添加到有编辑权限的项目中。业务 Agent 复用默认助理 Agent 的底层机制：私有工作区、`./freechat` CLI、Agent Tool API、WebSocket 广播、`agent_runs` 记录完全一致；区别在于业务可配置名称、职责、专长、系统提示词、响应模式和工具权限。

### Agent 配置

`agents.config` 使用 JSON 存储运行配置：

```ts
type AgentRuntimeConfig = {
  systemPrompt?: string
  behavior?: {
    replyMode?: 'mention_only' | 'auto_when_relevant'
    silentAllowed?: boolean
  }
  tools?: {
    chat?: boolean
    task?: boolean
    file?: boolean
    tab?: boolean
    interaction?: boolean
    members?: boolean
  }
}
```

默认配置：

- 业务助理：`auto_when_relevant`，默认允许 chat/task/file/tab/interaction/members。
- 业务专家：`mention_only`，默认允许 chat/task/file/interaction/members，默认不允许 tab。

Agent 运行时会把业务配置拼入 system prompt，同时保留系统边界：只能通过 `./freechat` 操作项目，不直接改共享目录；需要用户决策时使用 interaction；长期事项使用 task/progress。

### Agent 房间上下文与协作者可见性

所有 Agent 必须能看到当前房间的人类成员和 Agent 协作者。服务端维护两类上下文：

- `.freechat/ROOM.md`：房间基本信息和当前 Agent 身份。
- `.freechat/MEMBERS.md`：人类成员与 Agent 协作者列表。

`MEMBERS.md` 中的 Agent 信息必须包含：

- Agent 名称和 ID。
- `roleType` / `roomRole`。
- 是否 `autoEnabled`。
- 当前状态。
- 描述和专长。
- 自定义 prompt 摘要。

刷新策略：

1. Agent 启动前，`prepareAgentWorkspace()` 会重新生成当前 Agent 工作区的 `.freechat/ROOM.md` 和 `.freechat/MEMBERS.md`，确保至少本次运行看到最新协作者。
2. 新建项目、添加/移除 Agent、添加人员、加入项目、成员资料变更后，服务端会刷新房间内所有 Agent 工作区的上下文文件。
3. `./freechat members list` 是运行时可信来源，会返回当前房间的人类成员和完整 Agent 列表。

这样助理在分派专家前可以读取 `.freechat/MEMBERS.md` 或调用 `members list`，知道当前房间有哪些专家、专长是什么，以及应该用哪个名称/ID 执行 `--assignee`。

### 工具权限硬控

工具权限不只写进 prompt，后端在 `POST /api/agent-tools/:roomId` 入口强制校验：

- `chat.*` 需要 `tools.chat`
- `task.*` 需要 `tools.task`
- `file.*` / `tab-config.*` 需要 `tools.file`
- `tab.*` 需要 `tools.tab`
- `interaction.*` 需要 `tools.interaction`
- `members.*` / `room.info` 需要 `tools.members`

未授权时返回 `AGENT_TOOL_FORBIDDEN`。

### 房间内 Agent 角色

`room_agents` 扩展房间内配置：

```sql
room_role TEXT DEFAULT 'specialist',  -- assistant / specialist
auto_enabled INTEGER DEFAULT 0,
priority INTEGER DEFAULT 0
```

规则：

1. 一个房间可以有多个 Agent。
2. 一个房间最多一个 `auto_enabled = 1` 的自动 Agent；设置新自动 Agent 时自动关闭同房间其他 Agent 的自动响应。
3. 用户没有明确 @ 专家时，只有 `auto_enabled` 助理作为入口响应；后端不自动把未 @ 消息路由给专家。
4. 助理是调度者：自己能高质量完成就自己做；当前房间有更合适的专家时，应优先通过任务/子任务分派给专家，而不是自己硬做。
5. 专家 Agent 默认只在被人类 @ 或任务/子任务分派时响应，不能因为用户普通发言就突然插话。
6. AI 普通消息不触发其他 Agent，防止 Agent 互相刷屏。
7. Agent 不允许通过普通 @ 自动调度另一个 Agent；多 Agent 协作优先通过任务/子任务和交互卡完成。
8. 助理分派专家时必须创建真实任务/子任务，不能只在聊天里输出“任务表”或 @ 专家。Agent CLI 支持 `--assignee <agentNameOrId>` 指定房间内专家，服务端会解析为 `assignee_id/assignee_name/assignee_type='agent'`。

### 通讯录与项目协作者入口

Agent 被视为通讯录资源，而不是单独的项目设置项。首页通讯录分为：

- 人员：好友、好友搜索、好友申请。
- Agent：我的业务 Agent，支持创建和删除。

新建项目时也使用“选择协作者”模型：

- 可选好友人员作为初始项目成员，默认角色为 editor。
- 可选通讯录 Agent 作为初始项目 Agent。
- 选中的 Agent 可设置为“专家”或“自动助理”。
- 若选中了自定义自动助理，系统仍会创建默认房间助理，但默认助理的 `auto_enabled` 关闭；若没有自定义自动助理，默认房间助理保持自动响应。
- 后端只允许把当前用户拥有的 Agent 作为初始 Agent 加入新项目。

项目设置页统一为“协作者”模型，不再提供独立的“Agent 管理”入口：

- 协作者列表同时展示人员和 Agent。
- “添加协作者”按钮打开统一弹窗。
- 弹窗内分“人员 / Agent”两个 Tab。
- 添加人员时可搜索用户并添加为项目编辑者。
- 添加 Agent 时从通讯录 Agent 中选择，并设置为“专家”或“自动助理”。
- 当前房间 Agent 列表展示“自动助理/助理/专家”标识。

第一版中，自定义 Agent 仅 owner 本人可见/可添加；Agent 创建入口在通讯录 Agent 分类中。

## Agent 处理状态提示

Agent 被服务端触发后，不再向聊天流发送“收到，处理中…”回执消息，避免打扰对话。服务端只广播：

```ts
agent.status_update -> working
```

前端用成员入口、成员列表和对话头像上的呼吸灯提示 Agent 正在处理。Agent 完成后广播 `active/online` 状态并正常发送正式回复；若失败则广播 `error` 状态。

历史上保留的 `agent_receipt` 消息类型仍兼容展示；自动助理构建上下文时仍过滤 `agent_receipt`，避免旧回执污染后续判断。AI 普通消息不触发其他 Agent，因此状态提示也不会造成 Agent 循环。

## Agent 任务创建策略与上下文文件大小

Agent 不应把所有用户请求都转成任务。简单、单 Agent 可以直接完成的事项应直接处理并简短汇报；只有复杂需求、跨 Agent 协作、需要长期跟踪、或需要助理讨论分发时，才创建父任务。

已创建的父任务默认由房间助理 Agent 接管。助理负责判断：自己完成，或拆成子任务分派给专家 Agent。若房间存在明显更合适的专家，助理应优先分派专家，而不是自己硬做；但这个“专家优先”是助理内部调度策略，不是后端自动路由策略。专家 Agent 不应绕过助理随意创建父任务；必要时可向助理汇报建议，由助理统一建父任务/子任务。

助理可以查看当前房间协作者，也可以在用户要求或任务需要时拉入当前用户可用的业务 Agent：

```bash
./freechat members list
./freechat agent list-available
./freechat agent add "分镜专家"
```

`agent.add` 仅允许当前房间助理 Agent 调用；普通专家 Agent 不能自行拉入其他 Agent。第一版只允许添加当前 Agent owner 可用且尚未在房间内的 Agent，不开放添加人类成员。添加后服务端刷新所有 Agent 可见上下文，并通过房间成员更新事件同步前端成员/Agent 列表。

助理不能包办所有专家工作。遇到复合任务、长内容任务、或明显命中房间专家专长的任务，应先查看协作者；如果有匹配专家，禁止直接产出最终成品，必须先用 `./freechat task plan create-json` 发真实任务计划交互卡，或在用户已明确要求立即执行时创建真实任务/子任务并分派专家。禁止只用普通聊天文本、Markdown 表格或数字选项假装任务计划。典型场景：用户同时要求“剧本/编剧/文字”和“分镜/镜头/画面”时，助理应拆给剧本编剧与分镜专家，自己只做协调和最终汇总。

助理分派专家必须通过真实任务工具完成，例如：

```bash
./freechat task create "编剧专家：创作剧本" "基于故事写出剧本大纲" --assignee "剧本编剧"
./freechat task subtask add <taskId> "分镜专家：编写分镜" "基于剧本生成分镜" --assignee "分镜专家"
```

服务端在 `task.create` / `task.subtask_add` 中解析 `--assignee`，只允许匹配当前房间内 Agent。若被分派 Agent 与当前 Agent 不同，服务端会立即唤醒被分派专家，并发送 `agent_receipt` 回执。AI 聊天文本里的 `@专家` 仍不会触发专家，避免 Agent 循环。

### 任务计划预览与用户确认

复杂事项或多 Agent 分工任务，在创建真实任务前应优先让用户确认任务计划。Agent CLI 提供：

```bash
./freechat task plan create-json res/task-plan.json
```

计划 JSON 示例：

```json
{
  "title": "制作短视频《路灯下的阿橘》",
  "description": "根据故事生成剧本和分镜",
  "priority": "medium",
  "items": [
    {
      "title": "创作短视频剧本",
      "description": "基于故事创作短视频剧本",
      "assignee": "剧本编剧"
    },
    {
      "title": "生成分镜",
      "description": "根据剧本生成分镜脚本",
      "assignee": "分镜专家",
      "dependsOn": 0
    }
  ]
}
```

服务端会创建 `interaction.type = 'task_plan'` 的交互卡片，前端展示父任务、步骤、负责人和依赖关系。用户点击“确认创建”后，服务端才创建真实父任务和子任务，解析各步骤 `assignee`，并唤醒被分派 Agent；点击取消则不创建任务。这个机制用于避免 Agent 自作主张建任务，也避免只在聊天里输出“假任务表”。

Agent 工作区 Markdown 文件必须控制大小：`AGENT.md`、`CLAUDE.md`、`.freechat/API.md` 等单文件不超过 500 行。超过时应拆分到 `res/` 下的专题文件，主 Markdown 只保留索引、摘要和按需读取路径，避免每次启动加载过多上下文。

### 新父任务自动唤醒助理

当人类创建父任务且未指定负责人时，服务端会将任务分配给房间助理 Agent，并立即唤醒助理。助理收到任务上下文后必须判断：简单任务直接完成并汇报；复杂或跨 Agent 任务则拆分子任务并分派专家。Agent 自己通过工具创建任务时不触发此自动唤醒，避免递归触发。

### 任务进展可见性

助理接管父任务后必须主动汇报：先在聊天中说明已接管和处理计划，再用 `./freechat task progress <taskId> "进展说明"` 写入结构化最近进展。任务卡片显示 `progressNote`，用户无需展开任务即可看到最新处理状态。

### 任务房间隔离

Agent 工具只能操作当前房间的任务。服务端在 `task.update`、`task.progress`、`task.subtask_*` 等操作中校验父任务 `room_id`，传入其他房间的任务或子任务 ID 会被拒绝，避免跨项目串任务。
