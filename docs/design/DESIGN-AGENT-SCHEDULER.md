# Agent 调度系统设计

## 核心原则

1. **每个房间默认只有一个助理 Agent**，它自己完成所有工作
2. **专家 Agent 需要用户主动添加**，从 Agent 市场搜索/自己部署
3. **Agent 有两种部署模式**：服务端（云端托管）和客户端（用户本地）
4. **Agent 自己判断、自己行动**，服务端只做消息中继和工具执行

---

## 助理 Agent 的特殊地位

**助理是房间里唯一的决策者和管理者**，其他 Agent 只能执行任务和建议。

### 助理独有的权限

| 权限 | 助理 | 专家 Agent |
|------|------|-----------|
| 创建任务 | ✅ | ✅（需同步助理） |
| 分配任务给其他 Agent | ✅ | ❌ |
| 组织多 Agent 讨论 | ✅ | ❌ |
| 汇总结论并拍板方案 | ✅ | ❌ |
| 自主决策（常规方案） | ✅ | ❌ |
| 请求用户确认（重要方案） | ✅ | ❌ |
| 执行分配给自己的任务 | ✅ | ✅ |
| 发表观点和建议 | ✅ | ✅ |
| 读写文件 | ✅ | ✅ |

### 拍板决策流程

```
助理判断需求
  ↓
判断重要程度
  ├─ 常规方案（改样式、加功能、修 bug）
  │   → 助理直接拍板
  │   → 创建任务并分配
  │
  └─ 重要方案（架构变更、安全决策、产品方向）
      → 组织讨论（如有多个专家）
      → 汇总结论
      → @用户 请求确认
      → 用户确认后拍板执行
```

### 助理 vs 专家

**助理 Agent：**
- 始终在线，监听所有消息
- 判断意图、拆解需求、分配任务
- 有权创建任务、拍板方案
- 相当于项目经理 + 技术负责人

**专家 Agent：**
- 只关注分配给自己的任务
- 执行具体工作（写代码、做测试、写文档）
- 可以创建任务（如拆分子任务），但会自动同步给助理
- 完成后汇报给助理
- 不能分配任务给别人、不能拍板方案
- 相当于普通团队成员

---

## 1. Agent 部署模式

### 服务端 Agent（云端托管）

平台负责运行 Claude Code CLI，用户无需关心部署：

```
用户添加 Agent → 服务端启动 Claude Code → 维护 session → 自动响应
```

- 助理 Agent：房间创建时自动启动，始终在线
- 专家 Agent：用户从 Agent 市场添加后启动

### 客户端 Agent（用户本地部署）

用户在自己机器上运行 Agent 进程，通过 API 接入：

```
用户本地 Agent 进程 → WebSocket + API Key → FreeChat 服务端 → 房间内协作
```

适合场景：
- 需要访问本地资源（本地文件、数据库、内网服务）
- 使用私有模型或自定义逻辑
- 不想数据经过平台

接入方式：
```typescript
// 客户端 Agent SDK 伪代码
const agent = new FreeChatAgent({
  apiKey: "ak_xxx",          // 用户在 FreeChat 设置页生成
  rooms: ["rm_abc123"]       // 加入的房间
});

// Agent 收到房间内所有消息，自己判断要不要回应
agent.onMessage(async (message) => {
  if (shouldRespond(message)) {
    const response = await myLocalLLM.chat(message);
    await agent.sendMessage(response);
    
    // 也能调用系统 API
    await agent.createTask("xxx", { priority: "high" });
  }
});

agent.start();
```

### 房间内的 Agent 组合示例

```
房间 A（简单项目）：
  🤖 AI助理（服务端，默认）
  → 没有其他 Agent，助理一个人全干

房间 B（正式项目）：
  🤖 AI助理（服务端）
  🤖 前端专家（服务端，用户从市场添加）
  🤖 测试专家（客户端，用户本地部署）
```

---

## 2. Agent 市场

### 市场结构

```
Agent 市场
├── 官方推荐
│   ├── 前端开发专家（React/Vue/Tailwind）
│   ├── 后端开发专家（Node.js/Python/Go）
│   ├── 测试工程师（Jest/Playwright）
│   ├── 文档工程师（技术文档/API文档）
│   └── 数据分析师（Python/Pandas/可视化）
├── 社区贡献
│   └── 用户发布的自定义 Agent
└── 我的 Agent
    └── 用户自己创建的 Agent（可发布到市场）
```

### Agent 卡片信息

```
┌─────────────────────────────────┐
│ 🤖 前端开发专家                  │
│                                 │
│ 擅长 React、Vue、Tailwind CSS   │
│ 能开发完整的前端页面和组件       │
│                                 │
│ 部署方式：☁️ 服务端              │
│ 使用次数：1,234                 │
│ 评分：⭐ 4.8                    │
│                                 │
│ [添加到房间]                     │
└─────────────────────────────────┘
```

### 添加流程

```
1. 用户在房间设置页点击 "添加 Agent"
2. 打开 Agent 市场搜索/浏览
3. 选择 Agent → 确认添加
4. 服务端启动 Agent（服务端模式）或等待连接（客户端模式）
5. Agent 加入房间，开始监听消息
```

---

## 3. 服务端职责（极简）

```typescript
async function onUserMessage(roomId: string, message: WSMessage) {
  // 1. 持久化 + 广播给人类
  saveMessage(message);
  broadcast(roomId, message);
  
  // 2. 获取房间内的 Agent 列表
  const agents = getRoomAgents(roomId);
  
  // 3. 推送给所有 Agent（异步，并行）
  for (const agent of agents) {
    if (agent.deployment === 'server') {
      await feedToServerAgent(roomId, agent, message);
    }
    // 客户端 Agent 通过 WebSocket 已经在收消息了，不需要额外推送
  }
}

async function feedToServerAgent(roomId: string, agent: Agent, message: WSMessage) {
  const sessionId = getSessionId(roomId, agent.id);
  const roomDir = `/workspace-data/${roomId}`;
  
  const context = buildContext(roomId, message, agent);
  
  const output = await runClaudeCLI({
    prompt: context,
    cwd: roomDir,
    resume: sessionId,
    mcpConfig: `${roomDir}/.claude/mcp.json`
  });
  
  if (output.trim() !== '[SILENT]') {
    broadcastAsAgent(roomId, agent.id, output);
  }
}
```

服务端**只做**：
- ✅ 消息中继（人 → Agent，Agent → 人）
- ✅ 进程管理（启动/停止服务端 Claude Code CLI）
- ✅ MCP 工具执行
- ✅ session-id 维护
- ✅ 文件变更监听 + 广播

服务端**不做**：
- ❌ 意图识别
- ❌ 任务分发
- ❌ 判断消息是否和 Agent 有关

---

## 4. Agent 自主判断

### CLAUDE.md（每个 Agent 自动生成，内容因角色而异）

**助理 Agent 的 CLAUDE.md：**

```markdown
# 你是这个房间的 AI 助理

## 房间信息
你需要了解房间成员时，读取 .freechat/MEMBERS.md 文件。
这个文件包含所有成员的角色、能力、权限信息。

## 你的能力

### 聊天
- send_message(content) - 发消息到聊天流

### 任务
- create_task(title, description?, priority?, assignee?) → task_id
  assignee 填 Agent 名称或人类用户名
- update_task(task_id, { status?, title?, description? })
  status: todo → doing → done
- list_tasks(status?)
- delete_task(task_id)

### 文件
直接读写当前目录下的文件：
- files/ - 项目文件
- ui/tabs/ - UI 面板 HTML
- chat/ - 聊天记录
- .freechat/MEMBERS.md - 房间成员档案

### 房间
- get_room_info() - 房间信息

## 判断规则
1. 和你无关的消息 → 回复 [SILENT]
2. 需要你做事 → 回复并行动
3. 不确定 → 简短确认
4. 需要分配任务时，先读 MEMBERS.md 了解谁适合做什么

## 工作风格
- 简洁回复
- 有专家就分配任务，没有就自己干
- 先确认需求再动手
- 完成后主动汇报
```

**专家 Agent 的 CLAUDE.md：**

```markdown
# 你是 {{name}}

{{description}}

## 你的专长
{{#each specialties}}
- {{this}}
{{/each}}

## 你的能力
（同助理，但侧重自己的专业领域）

## 判断规则
1. 分配给你的任务 → 立即开始，回复确认
2. 和你专业相关的问题 → 回答
3. 其他 → 回复 [SILENT]
```

### 静默机制

```
Agent 输出 [SILENT] → 服务端不广播，静默跳过
Agent 输出其他内容 → 服务端以该 Agent 身份广播到房间
```

### 上下文构建

```typescript
function buildContext(roomId: string, message: WSMessage, agent: Agent): string {
  const recentMessages = getRecentMessages(roomId, 20);
  const tasks = getTasks(roomId);
  
  return `
## 当前任务
${tasks.map(t => `- [${t.status}] ${t.title} (分配给: ${t.assignee || '无'})`).join('\n') || '无'}

## 最近对话
${recentMessages.map(m => `[${m.actor.name}] ${m.content}`).join('\n')}

## 新消息
[${message.actor.name}] ${message.payload.content}

根据以上信息判断：你是否需要回应？不需要则回复 [SILENT]。
需要分配任务时，先读取 .freechat/MEMBERS.md 了解成员信息。
  `.trim();
}
```

---

## 5. 会话管理

### session-id 存储

```sql
-- 每个 Agent 在每个房间有独立 session
CREATE TABLE agent_sessions (
  room_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT NOT NULL,        -- Claude Code session-id
  message_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, agent_id)
);
```

### session 策略

| 场景 | 处理 |
|------|------|
| Agent 加入房间 | 首次调用 Claude Code，获取 session-id |
| 后续消息 | `--resume <session-id>` 保持上下文 |
| session 过长（> 100 轮） | 新建 session |
| Agent 被移除 | 清理 session 记录 |

---

## 6. MCP 工具

### 配置（每个房间自动生成）

```json
// /workspace-data/{RoomID}/.claude/mcp.json
{
  "mcpServers": {
    "freechat": {
      "command": "node",
      "args": ["/app/mcp-server/index.js"],
      "env": {
        "ROOM_ID": "rm_abc123",
        "API_BASE": "http://localhost:3000"
      }
    }
  }
}
```

### 工具列表

```typescript
// ─── 消息 ──────────────────────────────

send_message(content: string)
  描述: 发消息到聊天流，所有人可见
  示例: send_message("登录页面开发完成")

// ─── 任务 ──────────────────────────────

create_task(title: string, description?: string, priority?: "low"|"medium"|"high", assignee?: string)
  描述: 创建任务，广播到聊天流。assignee 填 Agent 名称或用户名。
  返回: { task_id: "tsk_xxx", status: "todo" }

update_task(task_id: string, updates: { status?: "todo"|"doing"|"done", title?, description? })
  描述: 更新任务
  返回: { success: true }

list_tasks(status?: string)
  描述: 查看任务列表
  返回: Task[]

delete_task(task_id: string)
  返回: { success: true }

// ─── 房间 ──────────────────────────────

list_members()
  描述: 查看房间所有成员（人类 + Agent）
  返回: { id, name, role, type: "human"|"agent", status }[]

list_agents()
  描述: 查看房间内 Agent 列表及状态
  返回: { id, name, role_type, deployment, status, current_task? }[]

get_room_info()
  描述: 房间基本信息
  返回: { id, name, description, created_at, member_count }
```

---

## 数据结构、API 与流程拆分

为控制单文件大小，数据库设计、REST API、完整流程示例、文件监听、错误处理、房间文件夹结构已拆分到：

- [DESIGN-AGENT-SCHEDULER-API.md](./DESIGN-AGENT-SCHEDULER-API.md)
