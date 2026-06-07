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
