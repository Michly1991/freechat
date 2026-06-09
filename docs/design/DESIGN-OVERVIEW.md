# FreeChat 系统设计总览

FreeChat 是一个 AI 协同办公云系统，设计分为两大部分：

---

## 第一部分：聊天室核心功能

聊天室是系统的基础设施，提供实时通讯、文件协作、任务管理等核心能力。

### 核心特性

1. **实时双向通信**：基于 WebSocket 的消息总线
2. **隔离的项目空间**：每个房间独立的 `RoomID` 和目录存储；前端文件 Tab、Agent CLI、上传/删除接口必须统一使用 `config.workspace.root/{RoomID}/files/`。
3. **动态 UI 引擎**：Tab 页签为内嵌 HTML，支持热更新
4. **智能 @提及机制**：精准 @人或 Agent，触发高亮和推送
5. **人机平权 API**：人类和 Agent 通过统一的 WebSocket API 操作

### 技术栈

- **后端**：Node.js + Fastify + ws + TypeScript + SQLite
- **前端**：React 18 + Vite + TypeScript + Zustand + Tailwind CSS
- **部署**：本地直接部署（第一版不使用 Docker）
- **文件工作区路径**：`WORKSPACE_ROOT` 必须解析为绝对路径，避免后端启动目录不同导致 Agent 写入目录和前端文件 Tab 读取目录不一致。

### 核心模块

#### 1. 聊天模块
- 实时消息收发（最多保留 50 条/房间）
- @提及高亮 + 通知
- 消息编辑/删除
- 打字状态指示器

#### 2. 文件系统
- 项目文件 CRUD
- 目录结构管理
- 文件变更实时通知
- 原子写入保证一致性

#### 3. 动态 UI (Tabs)
- Tab 注册表管理
- HTML 内容热更新
- iframe 沙箱安全渲染
- 所见即所得的多端同步
- 每个 Tab 通过 `workspace-data/{roomId}/meta/tabs.json` 配置可见文件项；未加入配置的文件不在对应 Tab 显示。详见 `DESIGN-TAB-CONFIG.md`。

#### 4. 任务看板
- 8 种状态：todo / assigned / doing / review / blocked / done / failed / cancelled
- 任务分配（人/Agent）
- 状态流转 + 自动通知
- 看板视图（桌面多列/移动 Tab 切换）
- 交互动效采用轻量高级感：任务/交互卡淡入、卡片 hover 上浮、按钮按压、进度条平滑过渡、待审核柔光、Agent 头像 hover/working 呼吸；移动端使用玻璃感 sticky 顶栏/输入栏、圆角 bottom sheet、44px 触控目标和安全区适配；需支持 `prefers-reduced-motion` 降级，保证移动端性能。

#### 5. 房间管理
- 创建/删除房间
- 成员邀请（链接/搜索）
- 权限模型（owner/editor/viewer）
- 房间设置
- 永久删除项目仅允许 `owner` 操作；后端必须强制校验，非 owner 返回 HTTP 403 和明确错误文案 `你没有权限永久删除该项目`。
- 前端危险操作区和首页项目会话的删除入口必须根据权限给出可见反馈：无权限点击时提示 `你没有权限永久删除该项目`，不能出现点击无效；有权限时展示二次确认后再调用删除接口。

#### 6. 用户系统
- 注册/登录（JWT）
- 个人设置（昵称/头像/密码）
- 首页项目列表

### 数据库设计

```sql
users                  -- 用户表
rooms                  -- 房间表
messages               -- 消息表（最多 50 条/房间）
tasks                  -- 父任务表（8 种状态）
task_items             -- 子任务/检查项
interaction_requests   -- 用户确认/选择/多选交互卡
agent_sessions         -- Agent CLI session 续接记录
agent_messages         -- provider-api 模式下的 Agent 历史
agent_runs             -- Agent 每次执行的运行记录/错误追踪
tabs                   -- Tab 元数据
room_members           -- 房间成员关联
room_agents            -- 房间 Agent 关联，含 room_role/auto_enabled/priority
schema_migrations      -- 数据库迁移记录
```

数据库启动流程采用“幂等 schema 初始化 + `schema_migrations` 迁移记录”。当前版本以 `001_schema_baseline` 标记现有 schema 基线；后续破坏性或复杂结构变更必须新增迁移版本，不再依赖删库重建。

### WebSocket 协议

```typescript
{
  msgId: string,
  roomId: string,
  type: 'api_request' | 'api_response' | 'broadcast' | 'system',
  action: string,
  payload: Record<string, unknown>,
  actor?: { id: string, name: string, role: 'human' | 'ai', avatar?: string },
  timestamp: number
}
```

当前已显式约定的事件包括：

- `chat.message` / `chat.history_result` / `chat.edited` / `chat.deleted` / `chat.typing_update`
- `interaction.created` / `interaction.updated`
- `task.list_result` / `task.changed`
- `agent.status_update`
- `files.updated` / `tabs.updated`
- `room.joined` / `room.member_join` / `room.member_leave` / `room.online_update`

前后端共享包维护 `WSMessage` 和 `WSEventAction` 类型，新增事件必须先更新共享类型和设计文档。消息 `kind` 目前包含普通文本、交互卡、系统消息和 `agent_receipt`（Agent 受理回执）。交互卡类型包含 `task_plan`，用于让用户确认任务计划后再创建真实任务/子任务。

多 Agent 触发规则：人类消息可以 @ 一个或多个 Agent；无人 @ 时只触发当前房间唯一 `auto_enabled` 助理，后端不会自动把未 @ 消息路由给专家；AI 普通消息不再触发其他 Agent，避免 Agent 互相对话造成循环。专家优先处理由助理内部调度实现：助理判断有合适专家时通过任务/子任务分派，而不是系统让专家突然插话。Agent CLI 的 `task create` / `task subtask add` 支持 `--assignee <agentNameOrId>`，服务端会解析房间内专家并在真实任务分派后唤醒被分派 Agent；聊天文本中的 `@专家` 不触发。

产品层将人员和 Agent 统一抽象为“协作者”：通讯录中包含“人员 / Agent”两个分类，Agent 的创建与管理放在通讯录 Agent 分类；新建项目时可选择初始人员和 Agent；项目设置页使用一个“添加协作者”弹窗，内部切换“人员 / Agent”，底层仍分别写入 `room_members` 和 `room_agents`。Agent 工作区的 `.freechat/MEMBERS.md` 和运行时 `members.list` 必须展示完整协作者信息；成员/Agent 变更后刷新所有房间 Agent 上下文，Agent 启动前也会刷新当前上下文。

### REST API

- `/api/auth/*` - 认证（注册/登录/刷新）
- `/api/user/*` - 用户设置（资料/密码/头像）
- `/api/rooms/*` - 房间管理（CRUD/成员/权限）

### 移动端适配

- 响应式布局（桌面侧边栏 / 移动底部 Tab）
- 虚拟滚动优化长列表
- 触摸手势（左滑回复/长按菜单）
- PWA 支持（可选）

---

## 第二部分：Agent 协同设计

Agent 是系统的智能层，通过 Claude Code CLI 实现 AI 协同工作。

### 核心理念

1. **Agent 即用户**：Agent 通过 API 接入，和人类使用相同的协议
2. **每房间一个助理**：默认只有一个助理 Agent，自己完成所有工作
3. **专家按需添加**：用户从 Agent 市场搜索/自己部署专家 Agent
4. **Agent 自主判断**：通过读取聊天记录决定要不要回应
5. **两种部署模式**：服务端（云端托管）和客户端（用户本地）

### Agent 类型

#### 助理 Agent（Room Assistant）
- 每个房间默认有一个
- 始终在线监听消息
- 判断意图：自己干 or 分配给专家
- 汇总结果，汇报给用户

#### 专家 Agent（Specialist）
- 用户主动添加到房间
- 专注特定领域（前端/后端/测试/安全...）
- 收到分配给自己的任务后开始工作
- 完成后通知助理

### 部署模式

#### 服务端 Agent（云端托管）
```
用户添加 Agent → 服务端启动 Claude Code CLI → 维护 session → 自动响应
```
- 平台负责运行 Claude Code
- 用户无需关心部署
- 适合：官方推荐 Agent、社区 Agent

#### 客户端 Agent（用户本地）
```
用户本地 Agent 进程 → WebSocket + API Key → FreeChat 服务端
```
- 用户自己运行 Agent 程序
- 可以访问本地资源、私有模型
- 适合：需要本地文件/数据库、自定义逻辑

### Claude Code CLI 对接

```bash
# 单次执行（非交互）
claude -p "任务描述" --cwd /workspace-data/{RoomID}

# 恢复会话（保持上下文）
claude -p "继续任务" --resume <session-id> --cwd /workspace-data/{RoomID}
```

**关键特性：**
- `-p` 模式：非交互，执行完退出
- `--resume`：通过 session-id 保持上下文
- `--cwd`：指定工作目录（房间文件夹）
- 输出到 stdout，服务端解析后广播

### 房间文件夹结构

```
/workspace-data/{RoomID}/
├── CLAUDE.md              ← Agent 说明书（自动生成）
├── .claude/
│   └── mcp.json           ← MCP 工具配置
├── .freechat/
│   └── MEMBERS.md         ← 房间成员档案（解耦设计）
├── chat/                  ← 聊天记录
├── files/                 ← 项目文件
├── ui/                    ← Tab HTML
└── tasks/                 ← 任务数据
```

### Agent 自主判断机制

#### CLAUDE.md（Agent 说明书）
```markdown
# 你是这个房间的 AI 助理

## 房间信息
需要时读取 .freechat/MEMBERS.md 了解成员

## 你的能力
- send_message(content)
- create_task(title, assignee?, priority?)
- update_task(task_id, { status })
- list_tasks()
- 读写文件...

## 判断规则
1. 和你无关 → 回复 [SILENT]
2. 需要你做事 → 回复并行动
3. 不确定 → 简短确认
```

#### 静默机制
- Agent 输出 `[SILENT]` → 服务端不广播
- Agent 输出其他内容 → 广播到房间

### MCP 工具

Agent 通过 MCP 工具与系统交互：

```typescript
send_message(content)
create_task(title, description?, priority?, assignee?)
update_task(task_id, { status?, title?, description? })
list_tasks(status?)
delete_task(task_id)
get_room_info()
```

### 服务端职责（极简）

```typescript
async function onUserMessage(roomId, message) {
  // 1. 持久化 + 广播给人类
  saveMessage(message);
  broadcast(roomId, message);
  
  // 2. 喂给 Agent（异步）
  const sessionId = getSessionId(roomId);
  const output = await runClaudeCLI({
    prompt: buildContext(roomId, message),
    cwd: `/workspace-data/${roomId}`,
    resume: sessionId,
    mcpConfig: `${roomDir}/.claude/mcp.json`
  });
  
  // 3. 解析输出，广播 Agent 回复
  if (output.trim() !== '[SILENT]') {
    broadcastAsAgent(roomId, output);
  }
}
```

**服务端只做：**
- ✅ 消息中继
- ✅ 进程管理（启动 Claude Code CLI）
- ✅ MCP 工具执行
- ✅ session-id 维护
- ✅ 文件变更监听

**服务端不做：**
- ❌ 意图识别
- ❌ 任务分发
- ❌ 判断消息是否相关

### Agent 市场

#### 市场结构
```
Agent 市场
├── 官方推荐（前端专家/后端专家/测试工程师...）
├── 社区贡献（用户发布的自定义 Agent）
└── 我的 Agent（用户自己创建的）
```

#### 添加流程
```
1. 房间设置 → "添加 Agent"
2. 搜索/浏览 Agent 市场
3. 选择 → 确认添加
4. 服务端启动 Agent（服务端模式）或等待连接（客户端模式）
```

### 数据库设计（Agent 相关）

```sql
agents               -- Agent 定义表
room_agents          -- 房间 Agent 关联表
agent_sessions       -- Agent session 表（每房间一个 session）
room_profiles        -- 成员角色档案表（存在 MEMBERS.md）
```

### 任务状态机

```
todo → assigned → doing → review → done
                          ↓
                        blocked / failed
                          ↓
                        cancelled
```

**关键转换：**
- Agent 做完 → `review`（等人类确认）
- 遇到问题 → `blocked`（带原因）
- 审核不通过 → 退回 `doing`
- 任何状态可 `cancelled`
- `done/failed` 可重新打开

### REST API（Agent 相关）

```typescript
// Agent 市场
GET /api/agent-market/search?q=前端
GET /api/agent-market/featured

// 我的 Agent
POST /api/agents              // 创建 Agent
GET /api/agents               // 列表
PATCH /api/agents/:id         // 更新
DELETE /api/agents/:id        // 删除

// 房间内 Agent
POST /api/rooms/:roomId/agents          // 添加 Agent
GET /api/rooms/:roomId/agents           // 列表
DELETE /api/rooms/:roomId/agents/:id    // 移除
```

---

## 两部分的边界

### 聊天室核心（Part 1）
- 提供基础设施：通讯、文件、任务、UI
- 定义数据模型和 API 协议
- 不关心"谁"在操作（人/Agent 都一样）

### Agent 协同（Part 2）
- 基于 Part 1 的 API 构建智能层
- 通过 Claude Code CLI 实现 AI 能力
- 自主判断、自主行动
- 服务端只是消息中继

### 关键解耦点

1. **API 统一**：人和 Agent 用相同的 WebSocket 协议
2. **数据解耦**：Agent 通过读 MEMBERS.md 了解房间信息，不硬编码
3. **职责分离**：服务端不做判断，Agent 自己决定行为
4. **部署灵活**：Agent 可以云端托管，也可以用户本地运行

---

## 多 Agent 协同讨论

助理可以组织多个 Agent 讨论复杂问题：

### 讨论流程
```
用户发起讨论 → 助理组织 → 各 Agent 依次发言 → 助理汇总 → 用户确认 → 分配任务
```

### 助理判断规则
- 需求涉及多个领域 → 组织讨论
- 技术选型有多种方案 → 组织讨论
- 简单任务/单一领域 → 直接执行
- 重要方案 → 必须用户确认

详细设计见 `DESIGN-AGENT-COLLABORATION.md`

---

## 成员角色系统

每个成员（人 + Agent）都有角色档案，存储在 `.freechat/MEMBERS.md`：

### 角色信息
- **身份**：产品经理 / 技术负责人 / 前端开发...
- **人设**：性格特点、工作风格
- **能力**：专业领域标签
- **权限**：escalation_level（1-10）

### 解耦设计
- 服务端维护数据库
- 成员变动时自动更新 MEMBERS.md 文件
- Agent 按需读取文件，不直接调 API

详细设计见 `DESIGN-MEMBER-PROFILES.md`

---

## 开发阶段

### Phase 1 - 聊天室核心
- 用户系统（注册/登录/设置）
- 房间管理（创建/成员/权限）
- 聊天模块（消息/@提及）
- 文件系统（CRUD）
- 任务看板（8 状态）
- 动态 UI（Tab）

### Phase 2 - Agent 协同
- 助理 Agent 集成（Claude Code CLI）
- MCP 工具实现
- Agent 市场
- 专家 Agent 支持
- 多 Agent 协作

### Phase 3 - 增强
- 移动端优化
- 性能优化（虚拟滚动/懒加载）
- 通知系统
- Docker 部署
- PWA 支持

---

## 设计文档索引

所有设计文档位于 `docs/design/` 目录：

| 文档 | 内容 |
|------|------|
| `DESIGN.md` | 原始需求文档 |
| `ARCHITECTURE.md` | 聊天室技术架构（详细） |
| `DESIGN-AGENT.md` | Agent 体系设计 |
| `DESIGN-AGENT-SCHEDULER.md` | Agent 调度系统 |
| `DESIGN-AGENT-COLLABORATION.md` | 多 Agent 协同讨论 |
| `DESIGN-MEMBER-PROFILES.md` | 成员角色系统 |

---

## 实现细节拆分

历史实现补充、移动端细节、交互卡状态、任务归档与 2026-06-10 Agent 协作收口已拆分到：

- [DESIGN-IMPLEMENTATION-NOTES.md](./DESIGN-IMPLEMENTATION-NOTES.md)
