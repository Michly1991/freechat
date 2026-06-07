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

## 7. 数据库设计

```sql
-- Agent 定义表
CREATE TABLE agents (
  id TEXT PRIMARY KEY,                 -- agt_xxx
  name TEXT NOT NULL,
  description TEXT,
  specialties TEXT NOT NULL DEFAULT '[]',  -- JSON 数组
  deployment TEXT NOT NULL,            -- server | client
  created_by TEXT NOT NULL,            -- 创建者 user_id（system = 平台官方）
  system_prompt TEXT,                  -- Agent 的 system prompt
  config TEXT NOT NULL DEFAULT '{}',   -- JSON: model, 工具配置等
  api_key TEXT UNIQUE,                 -- 客户端 Agent 的接入密钥
  status TEXT NOT NULL DEFAULT 'active',
  published BOOLEAN DEFAULT FALSE,     -- 是否发布到市场
  usage_count INTEGER DEFAULT 0,
  rating REAL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 房间 Agent 关联表
CREATE TABLE room_agents (
  room_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  role_type TEXT NOT NULL DEFAULT 'specialist',  -- assistant | specialist
  session_id TEXT,                   -- Claude Code session-id（服务端 Agent）
  added_by TEXT NOT NULL,            -- 谁添加的
  status TEXT NOT NULL DEFAULT 'active',
  added_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, agent_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

-- 每个房间创建时自动插入助理 Agent
-- role_type = 'assistant'，不可被移除
```

---

## 8. REST API

```typescript
// ─── Agent 市场 ────────────────────────────

// 搜索 Agent 市场
GET /api/agent-market/search?q=前端&page=1
Response: {
  agents: [{
    id, name, description, specialties,
    deployment, created_by, usage_count, rating
  }],
  total: number,
  page: number
}

// 浏览推荐 Agent
GET /api/agent-market/featured
Response: { agents: Agent[] }

// ─── 我的 Agent ────────────────────────────

// 创建 Agent
POST /api/agents
Body: {
  name, description, specialties,
  deployment: "server" | "client",
  system_prompt?, config?,
  publish_to_market?: boolean
}
Response: { agent: Agent, api_key?: string }
// api_key 仅 client 模式返回，仅创建时返回一次

// 获取我的 Agent 列表
GET /api/agents
Response: { agents: Agent[] }

// 更新 Agent
PATCH /api/agents/:id
Response: { agent: Agent }

// 重新生成 API Key
POST /api/agents/:id/regenerate-key
Response: { api_key: string }

// 删除 Agent
DELETE /api/agents/:id
Response: { success: true }

// ─── 房间内 Agent 管理 ────────────────────────

// 添加 Agent 到房间（用户确认）
POST /api/rooms/:roomId/agents
Body: { agent_id: string }
Response: { success: true }
// 服务端 Agent：立即启动 Claude Code
// 客户端 Agent：等待 Agent 连接

// 获取房间 Agent 列表
GET /api/rooms/:roomId/agents
Response: {
  assistant: { id, name, status },
  specialists: [{ id, name, deployment, status, added_by, added_at }]
}

// 从房间移除 Agent（不能移除助理）
DELETE /api/rooms/:roomId/agents/:agentId
Response: { success: true }
// 服务端 Agent：停止 Claude Code 进程
// 客户端 Agent：断开 WebSocket
```

---

## 9. 完整流程示例

### 场景 A：没有专家 Agent（助理一个人干）

```
t0  用户："帮我做个登录页面"

t1  服务端广播消息 + 调用助理的 claude -p --resume session-1

t2  助理判断：需要做，没有专家可以分配，自己来
    行动：
    - send_message("好的，我来开发登录页面")
    - create_task("开发登录页面", "包含用户名密码输入框和登录按钮", "high")
    - 写 files/src/login.tsx
    - 写 files/src/login.css
    - update_task(task_id, { status: "done" })
    - send_message("✅ 完成，已创建 login.tsx 和 login.css")

t3  用户看到的聊天流：
    👤 你        11:18  帮我做个登录页面
    🤖 AI助理    11:18  好的，我来开发登录页面
    📋 新任务    11:18  [高] 开发登录页面
    🤖 AI助理    11:20  ✅ 完成，已创建 login.tsx 和 login.css
    📋 任务更新  11:20  [已完成] 开发登录页面
```

### 场景 B：有专家 Agent（助理分配任务）

```
t0  用户："帮我做个登录页面，写完跑下测试"

t1  助理判断：需要开发和测试，房间里有前端专家和测试专家
    行动：
    - send_message("好的，我来安排：")
    - create_task("开发登录页面", ..., "high", assignee: "前端专家")
    - create_task("编写登录页测试", ..., "medium", assignee: "测试专家")

t2  前端专家收到任务（自己判断：分配给自己的）
    - send_message("收到，我来开发登录页面")
    - 写文件...
    - update_task(task_id, { status: "done" })
    - send_message("✅ 登录页面完成")

t3  测试专家收到任务
    - send_message("收到，我来写测试")
    - 写测试、跑测试...
    - update_task(task_id, { status: "done" })
    - send_message("✅ 测试通过 12/12")

t4  助理监听到任务完成，汇总汇报
    - send_message("全部完成 ✅ ...")
```

---

## 10. 文件监听

```typescript
// Claude Code 直接写文件，服务端检测变更并广播
fs.watch(roomDir + '/files/', { recursive: true }, (event, filename) => {
  broadcast(roomId, {
    action: 'file.changed',
    payload: { path: filename, event }
  });
});
```

---

## 11. 错误处理

```typescript
const MAX_RETRIES = 2;
const AGENT_TIMEOUT = 5 * 60 * 1000; // 5 分钟

async function runClaudeWithRetry(config) {
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      return await Promise.race([
        runClaudeCLI(config),
        timeout(AGENT_TIMEOUT)
      ]);
    } catch (error) {
      if (i === MAX_RETRIES) {
        broadcastAsAgent(config.roomId, config.agentId,
          "抱歉，遇到了问题，请稍后重试。"
        );
      }
      await sleep(2000 * (i + 1));
    }
  }
}
```

---

## 12. 房间文件夹结构

```
/workspace-data/{RoomID}/
├── CLAUDE.md              ← Agent 说明书（按角色生成不同版本）
├── .claude/
│   └── mcp.json           ← MCP 工具配置
├── chat/
│   └── history.db         ← 聊天记录
├── files/                 ← 项目文件
├── ui/
│   ├── manifest.json      ← Tab 注册表
│   └── tabs/              ← Tab HTML
└── tasks/
    └── (SQLite 存储)
```

---

## 13. 待确定

1. **Claude Code --resume**：首次运行怎么拿 session-id？需实测
2. **输出解析**：MCP 工具调用和普通文本在 stdout 里怎么区分？
3. **上下文窗口**：session 太长怎么处理？
4. **费用控制**：每条消息都调一次 Claude Code，需要节流吗？
5. **客户端 Agent SDK**：提供哪些语言的 SDK？（Python/Node/Go？）
