# Agent 调度器数据结构、API 与完整流程

> 从 DESIGN-AGENT-SCHEDULER 拆分出的数据库、REST API、流程示例、文件监听与错误处理。

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
