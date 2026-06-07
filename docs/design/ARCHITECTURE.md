# FreeChat - AI协同办公云系统 技术架构设计

## 技术栈

### 后端
| 技术 | 选型 | 理由 |
|------|------|------|
| 运行时 | Node.js 20 LTS | 用户指定 |
| 框架 | Fastify | 高性能，原生 TS 支持，schema 校验内置 |
| WebSocket | ws (bare) + Fastify 插件 | 轻量可控，不引入 Socket.IO 的重量级抽象 |
| 语言 | TypeScript 5.x | 全栈统一类型系统 |
| 数据库 | SQLite (better-sqlite3) | 单文件部署，够用且零运维，游标查询友好 |
| 文件存储 | 本地文件系统 + 目录隔离 | 遵循设计文档的 RoomID 目录结构 |
| 认证 | JWT (jsonwebtoken) | 无状态，token 编码 room 权限 |
| 构建 | tsup / tsc | 快速编译 |
| 包管理 | pnpm | 快、省空间、严格依赖 |

### 前端
| 技术 | 选型 | 理由 |
|------|------|------|
| 框架 | React 18 | 复杂 UI 生态最成熟 |
| 构建 | Vite 5 | 极速 HMR，TS 原生支持 |
| 语言 | TypeScript 5.x | 类型安全 |
| 状态管理 | Zustand | 轻量，适合 WebSocket 实时状态，无 boilerplate |
| 样式 | Tailwind CSS 3 | 原子化 CSS，开发效率高 |
| 路由 | React Router v6 | 标准选择 |
| 图标 | Lucide React | 轻量一致 |
| HTTP 客户端 | fetch (原生) | REST 接口少，不需要 axios |
| WebSocket | 原生 WebSocket + 自封装重连 | 不依赖 Socket.IO client |

### 开发与部署
| 工具 | 用途 |
|------|------|
| Docker + Docker Compose | 一键部署 |
| ESLint + Prettier | 代码规范 |
| Vitest | 单元测试 |
| Playwright | E2E 测试（后期） |

---

## 项目结构

```
freechat/
├── packages/
│   ├── shared/                # 共享类型定义和常量
│   │   ├── src/
│   │   │   ├── types/         # WebSocket 消息类型、API 类型
│   │   │   │   ├── message.ts # WS 消息基础结构
│   │   │   │   ├── chat.ts    # 聊天相关类型
│   │   │   │   ├── file.ts    # 文件操作类型
│   │   │   │   ├── ui.ts      # Tab/UI 类型
│   │   │   │   ├── task.ts    # 任务类型
│   │   │   │   └── user.ts    # 用户/Agent 类型
│   │   │   ├── constants.ts   # Action 名称、错误码
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── server/                # 后端服务
│   │   ├── src/
│   │   │   ├── app.ts         # Fastify 应用初始化
│   │   │   ├── server.ts      # 入口，启动 HTTP + WS
│   │   │   ├── config.ts      # 环境变量配置
│   │   │   ├── ws/
│   │   │   │   ├── gateway.ts # WebSocket 连接管理
│   │   │   │   ├── router.ts  # 消息路由（按 action 分发）
│   │   │   │   ├── room.ts    # 房间连接池（在线成员追踪）
│   │   │   │   └── heartbeat.ts # 心跳检测
│   │   │   ├── services/
│   │   │   │   ├── chat.service.ts    # 聊天逻辑
│   │   │   │   ├── file.service.ts    # 文件 CRUD
│   │   │   │   ├── ui.service.ts      # Tab 管理
│   │   │   │   ├── task.service.ts    # 任务看板
│   │   │   │   └── room.service.ts    # 房间生命周期
│   │   │   ├── storage/
│   │   │   │   ├── db.ts              # SQLite 初始化 & 迁移
│   │   │   │   ├── migrations/        # SQL 迁移脚本
│   │   │   │   └── filesystem.ts      # 文件读写工具（原子写）
│   │   │   ├── auth/
│   │   │   │   ├── jwt.ts             # Token 签发/验证
│   │   │   │   └── middleware.ts       # 认证中间件
│   │   │   └── routes/
│   │   │       ├── auth.ts            # 注册、登录、刷新 Token
│   │   │       ├── user.ts            # 个人设置（昵称、头像、密码）
│   │   │       └── rest.ts            # 健康检查等公共端点
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                   # 前端应用
│       ├── src/
│       │   ├── main.tsx               # 入口
│       │   ├── App.tsx                # 根组件 & 路由
│       │   ├── pages/
│       │   │   ├── LoginPage.tsx      # 登录/注册页
│       │   │   ├── HomePage.tsx       # 首页（项目列表 + 新建）
│       │   │   ├── RoomPage.tsx       # 项目室详情页
│       │   │   └── SettingsPage.tsx   # 个人设置页
│       │   ├── components/
│       │   │   ├── layout/
│       │   │   │   ├── Sidebar.tsx    # 侧边栏（房间列表，仅房间内）
│       │   │   │   ├── Header.tsx     # 顶部栏
│       │   │   │   ├── BottomNav.tsx  # 移动端底部导航
│       │   │   │   └── RoomLayout.tsx # 房间主布局
│       │   │   ├── home/
│       │   │   │   ├── RoomCard.tsx   # 项目卡片
│       │   │   │   ├── RoomGrid.tsx   # 项目网格
│       │   │   │   └── CreateRoomModal.tsx # 新建项目弹窗
│       │   │   ├── auth/
│       │   │   │   ├── LoginForm.tsx  # 登录表单
│       │   │   │   └── RegisterForm.tsx # 注册表单
│       │   │   ├── settings/
│       │   │   │   ├── ProfileForm.tsx  # 昵称、头像编辑
│       │   │   │   └── PasswordForm.tsx # 修改密码
│       │   │   ├── chat/
│       │   │   │   ├── ChatPanel.tsx  # 聊天面板容器
│       │   │   │   ├── MessageList.tsx # 消息流
│       │   │   │   ├── MessageItem.tsx # 单条消息（含@高亮）
│       │   │   │   ├── ChatInput.tsx  # 输入框（含@弹窗）
│       │   │   │   ├── MentionPopup.tsx # @成员选择器
│       │   │   │   └── TypingIndicator.tsx
│       │   │   ├── files/
│       │   │   │   ├── FileTree.tsx   # 文件树
│       │   │   │   ├── FileEditor.tsx # 文件编辑
│       │   │   │   └── FileUploader.tsx
│       │   │   ├── tabs/
│       │   │   │   ├── TabBar.tsx     # Tab 栏
│       │   │   │   ├── TabContent.tsx # iframe 沙箱渲染
│       │   │   │   └── TabManager.tsx # Tab 增删改
│       │   │   ├── tasks/
│       │   │   │   ├── TaskBoard.tsx  # 看板视图
│       │   │   │   ├── TaskColumn.tsx # 列（待认领/进行中/待审核/已完成）
│       │   │   │   ├── TaskCard.tsx   # 任务卡片
│       │   │   │   └── TaskForm.tsx   # 创建/编辑表单
│       │   │   └── common/
│       │   │       ├── Avatar.tsx
│       │   │       ├── Badge.tsx
│       │   │       ├── Toast.tsx
│       │   │       └── Button.tsx
│       │   ├── stores/
│       │   │   ├── authStore.ts       # 登录状态、用户信息、token
│       │   │   ├── wsStore.ts         # WebSocket 连接状态
│       │   │   ├── chatStore.ts       # 消息列表、未读、提及
│       │   │   ├── fileStore.ts       # 文件树状态
│       │   │   ├── tabStore.ts        # Tab 列表状态
│       │   │   ├── taskStore.ts       # 任务看板状态
│       │   │   └── roomStore.ts       # 房间信息、成员列表
│       │   ├── hooks/
│       │   │   ├── useAuth.ts         # 登录/登出/路由守卫
│       │   │   ├── useWebSocket.ts    # WS 连接/重连/发送
│       │   │   ├── useMention.ts      # @提及逻辑
│       │   │   └── useNotification.ts # 通知提醒
│       │   ├── lib/
│       │   │   ├── api.ts            # REST API 封装（登录/注册/设置）
│       │   │   ├── ws.ts             # WebSocket 客户端封装
│       │   │   └── utils.ts
│       │   └── styles/
│       │       └── globals.css       # Tailwind 入口
│       ├── index.html
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── workspace-data/            # 运行时数据（gitignore）
├── docker-compose.yml
├── Dockerfile
├── pnpm-workspace.yaml
├── .gitignore
├── package.json               # monorepo root
└── tsconfig.base.json         # 共享 TS 配置
```

---

## WebSocket 消息协议（细化）

### 基础消息结构

```typescript
// packages/shared/src/types/message.ts

type MessageRole = 'human' | 'ai';
type MessageType = 'api_request' | 'api_response' | 'broadcast' | 'system';

interface Actor {
  id: string;           // user_123 | agent_llm_01
  name: string;         // 显示名称
  role: MessageRole;
  avatar?: string;      // 头像 URL
}

interface WSMessage {
  msg_id: string;       // uuid v4
  room_id: string;      // rm_xxx
  type: MessageType;
  action: string;       // chat.send | file.write | ...
  payload: Record<string, unknown>;
  timestamp: number;    // Unix ms
  actor: Actor;
  reply_to?: string;    // 关联的 request msg_id（仅 response 类型）
}
```

### 错误响应

```typescript
interface WSError {
  msg_id: string;
  type: 'api_response';
  success: false;
  error: {
    code: string;       // ROOM_NOT_FOUND | UNAUTHORIZED | FILE_TOO_LARGE
    message: string;
  };
}
```

### 系统事件（服务端主动推送）

```typescript
// 用户加入/离开
{ type: 'system', action: 'room.member_join', payload: { actor: Actor, members: Actor[] } }
{ type: 'system', action: 'room.member_leave', payload: { actor: Actor, members: Actor[] } }

// 在线成员列表变更
{ type: 'system', action: 'room.members_update', payload: { members: Actor[] } }
```

### 完整 Action 列表

| Action | 方向 | 描述 |
|--------|------|------|
| `chat.send` | Client → Server | 发送消息（含 mentions）。房间最多保留 50 条，超出后自动滚动删除最老消息 |
| `chat.history` | Client → Server | 请求历史消息（最多返回 50 条，无需分页） |
| `chat.typing` | Client → Server | 打字状态通知 |
| `chat.message` | Server → All | 新消息广播 |
| `chat.typing_update` | Server → All | 打字状态广播 |
| `chat.history_result` | Server → Client | 历史消息响应 |
| `chat.edit` | Client → Server | 编辑消息（仅作者，其他人看到"已编辑"标记） |
| `chat.delete` | Client → Server | 删除消息（作者或房间 owner） |
| `chat.edited` | Server → All | 消息编辑广播 |
| `chat.deleted` | Server → All | 消息删除广播 |
| `file.list` | Client → Server | 列出文件 |
| `file.read` | Client → Server | 读取文件内容 |
| `file.write` | Client → Server | 写入文件 |
| `file.delete` | Client → Server | 删除文件 |
| `file.upload` | Client → Server | 上传文件（base64） |
| `file.changed` | Server → All | 文件变更通知 |
| `ui.list_tabs` | Client → Server | 获取 Tab 列表 |
| `ui.create_tab` | Client → Server | 创建 Tab |
| `ui.update_tab` | Client → Server | 更新 Tab HTML |
| `ui.delete_tab` | Client → Server | 删除 Tab |
| `ui.tab_changed` | Server → All | Tab 变更广播 |
| `task.add` | Client → Server | 添加任务 |
| `task.update` | Client → Server | 更新任务状态 |
| `task.delete` | Client → Server | 删除任务 |
| `task.list` | Client → Server | 获取任务列表 |
| `task.changed` | Server → All | 任务变更广播 |

---

## 房间成员管理

### 邀请机制（双模式）

**方式一：邀请链接**
- 房间 owner/editor 生成邀请链接
- 链接格式：`https://domain.com/invite?code=xxx`
- 链接有效期 7 天，可设置最大人数限制
- 任何人打开链接 + 已登录 → 自动加入房间

**方式二：搜索用户名添加**
- 在房间设置中搜索用户名
- 发送邀请通知，对方确认后加入

### 权限模型

| 权限 | owner | editor | viewer |
|------|-------|--------|--------|
| 发送消息 | ✅ | ✅ | ❌ |
| 操作文件 | ✅ | ✅ | ❌ |
| 操作 Tab | ✅ | ✅ | ❌ |
| 操作任务 | ✅ | ✅ | ✅ |
| 邀请成员 | ✅ | ✅ | ❌ |
| 踢出成员 | ✅ | ❌ | ❌ |
| 修改成员权限 | ✅ | ❌ | ❌ |
| 编辑房间设置 | ✅ | ❌ | ❌ |
| 删除房间 | ✅ | ❌ | ❌ |
| 转让 owner | ✅ | ❌ | ❌ |

### 房间成员 REST API

```typescript
// 生成邀请链接
POST /api/rooms/:id/invite-link
Body: { max_uses?: number, expires_in_days?: number }
Response: { code: string, url: string, expires_at: number }

// 通过邀请码加入房间
POST /api/rooms/join
Body: { invite_code: string }
Response: { room: { id, name }, role: 'editor' }

// 搜索用户并邀请
POST /api/rooms/:id/invite
Body: { username: string }
Response: { success: true }

// 获取房间成员列表
GET /api/rooms/:id/members
Response: { members: [{ id, username, nickname, avatar, role, joined_at }] }

// 修改成员权限（仅 owner）
PATCH /api/rooms/:id/members/:userId
Body: { role: 'editor' | 'viewer' }
Response: { success: true }

// 踢出成员（仅 owner）
DELETE /api/rooms/:id/members/:userId
Response: { success: true }

// 转让 owner（仅 owner）
POST /api/rooms/:id/transfer-owner
Body: { new_owner_id: string }
Response: { success: true }

// 退出房间（非 owner）
POST /api/rooms/:id/leave
Response: { success: true }
```

### 房间设置页 (RoomSettingsPage)

路由：`/room/:roomId/settings`（房间内的设置入口）

```
┌──────────────────────────────────┐
│  ← 返回       项目设置           │
├──────────────────────────────────┤
│                                  │
│  项目名称                        │
│  [项目A____________]             │
│                                  │
│  项目描述                        │
│  [____________________]          │
│  [____________________]          │
│                                  │
│  [保存修改]                      │
│                                  │
│  ───────────────────             │
│                                  │
│  成员管理                [邀请]  │
│  ┌──────────────────────────┐    │
│  │ 👤 张三 (owner)    [...]  │    │
│  │ 👤 李四 (editor)   [...]  │    │
│  │ 👤 王五 (viewer)   [...]  │    │
│  └──────────────────────────┘    │
│                                  │
│  ───────────────────             │
│                                  │
│  [转让所有权]  [删除项目]        │
│                                  │
└──────────────────────────────────┘
```

- 移动端：全屏布局
- 桌面端：居中卡片，最大宽度 640px
- 成员点击 `[...]` 弹出操作菜单（改权限/踢出）
- 邀请按钮弹出 Modal：生成链接 / 搜索用户

---

## 数据库设计 (SQLite)

### 表结构

```sql
-- 用户表
CREATE TABLE users (
  id TEXT PRIMARY KEY,          -- usr_xxx
  username TEXT UNIQUE NOT NULL,-- 登录名
  password_hash TEXT NOT NULL,  -- bcrypt 哈希
  nickname TEXT NOT NULL,       -- 显示昵称
  avatar TEXT,                  -- 头像 URL
  role TEXT NOT NULL DEFAULT 'user',  -- user | admin
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 房间表
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,          -- rm_xxx
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL,
  invite_code TEXT,             -- 邀请码
  invite_expires_at INTEGER,    -- 邀请码过期时间
  invite_max_uses INTEGER,      -- 邀请码最大使用次数
  invite_used_count INTEGER DEFAULT 0,
  last_active_at INTEGER NOT NULL, -- 最近活动时间（消息/文件/任务变更时更新）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 消息表（替代 history.jsonl）
CREATE TABLE messages (
  id TEXT PRIMARY KEY,          -- msg_id
  room_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,     -- human | ai
  content TEXT NOT NULL,
  mentions TEXT,                -- JSON array of { id, name, role }
  reply_to TEXT,
  edited_at INTEGER,            -- 编辑时间（null 表示未编辑）
  deleted INTEGER DEFAULT 0,    -- 软删除标记（0=正常, 1=已删除）
  created_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE INDEX idx_messages_room_time ON messages(room_id, created_at);

-- 消息清理策略：每个房间最多保留 50 条
-- chat.send 时由服务端自动执行滚动删除：
-- DELETE FROM messages WHERE room_id = ? AND deleted = 0
--   AND id NOT IN (SELECT id FROM messages WHERE room_id = ? ORDER BY created_at DESC LIMIT 50);

-- 任务表（替代 board.json，避免并发写冲突）
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,          -- tsk_xxx
  room_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  -- todo | assigned | doing | review | blocked | done | failed | cancelled
  priority TEXT DEFAULT 'medium',       -- low | medium | high
  assignee_id TEXT,
  assignee_name TEXT,
  assignee_type TEXT,                   -- human | agent
  blocked_reason TEXT,                  -- 阻塞原因
  review_note TEXT,                     -- 审核备注
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,                 -- 完成时间
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE INDEX idx_tasks_room_status ON tasks(room_id, status);

-- Tab 元数据表（HTML 内容仍存文件系统）
CREATE TABLE tabs (
  id TEXT PRIMARY KEY,          -- tab_xxx
  room_id TEXT NOT NULL,
  title TEXT NOT NULL,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

-- 房间成员表
CREATE TABLE room_members (
  room_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',  -- owner | editor | viewer
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### 为什么用 SQLite 替代纯文件存储

| 设计文档方案 | 实际选择 | 理由 |
|-------------|---------|------|
| history.jsonl | SQLite messages 表 | 游标分页查询 O(log n)，JSONL 需全量扫描 |
| board.json | SQLite tasks 表 | 避免并发写冲突，支持事务 |
| manifest.json | SQLite tabs 表 | 同上 |
| context.db | 保留（后期接向量搜索） | MVP 不做，预留接口 |

### 文件存储保留项

- **项目文件**（`files/` 目录）：仍用文件系统，因为文件可能很大、有二进制内容
- **Tab HTML 内容**（`ui/tabs/` 目录）：HTML 片段存文件，元数据存 DB
- **用户头像**（`avatars/` 目录）：上传到 `workspace-data/avatars/`，返回可访问 URL
- **原子写入**：写临时文件 → fsync → rename，避免写坏

---

## 统一错误码

| 错误码 | HTTP Status | 含义 |
|--------|-------------|------|
| `UNAUTHORIZED` | 401 | 未登录或 token 失效 |
| `FORBIDDEN` | 403 | 无权限操作 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `ROOM_NOT_FOUND` | 404 | 房间不存在 |
| `NOT_ROOM_MEMBER` | 403 | 不是房间成员 |
| `FILE_NOT_FOUND` | 404 | 文件不存在 |
| `FILE_TOO_LARGE` | 413 | 超过 5MB 限制 |
| `TAB_NOT_FOUND` | 404 | Tab 不存在 |
| `TASK_NOT_FOUND` | 404 | 任务不存在 |
| `USERNAME_TAKEN` | 409 | 用户名已被注册 |
| `INVALID_PASSWORD` | 401 | 密码错误 |
| `INVITE_EXPIRED` | 410 | 邀请链接已过期 |
| `INVITE_FULL` | 403 | 邀请链接已达上限 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |

---

## 消息保留策略

每个房间最多保留 **50 条**消息，超出后自动滚动删除最老的消息。

### 实现方式

```typescript
// services/chat.service.ts
const MAX_MESSAGES_PER_ROOM = 50;

async function sendMessage(roomId: string, message: Message) {
  // 1. 插入新消息
  db.insertMessage(message);

  // 2. 清理超限消息（事务中执行，保证原子性）
  db.run(`
    DELETE FROM messages
    WHERE room_id = ?
      AND deleted = 0
      AND id NOT IN (
        SELECT id FROM messages
        WHERE room_id = ? AND deleted = 0
        ORDER BY created_at DESC
        LIMIT ?
      )
  `, [roomId, roomId, MAX_MESSAGES_PER_ROOM]);

  // 3. 广播新消息
  broadcast(roomId, { action: 'chat.message', payload: message });
}
```

### 前端行为

- `chat.history` 一次性返回房间全部消息（最多 50 条），无需分页
- 没有"加载更多"按钮，打开即看到全部历史
- 被滚动删除的消息前端不可见，也不会在任何地方展示

---

## 日志方案

- **服务端**：`pino`（Fastify 内置）
  - 开发环境：pretty print 到控制台
  - 生产环境：JSON 格式写入 `logs/server.log`，按天轮转
- **前端**：开发环境 `console`，生产环境可选接入 Sentry

---

## 认证与用户系统

### REST API 端点

```typescript
// ─── 认证 ────────────────────────────────

// 注册
POST /api/auth/register
Body: { username: string, password: string, nickname: string }
Response: { user: { id, username, nickname, avatar }, token: string }

// 登录
POST /api/auth/login
Body: { username: string, password: string }
Response: { user: { id, username, nickname, avatar }, token: string }

// 刷新 Token
POST /api/auth/refresh
Header: Authorization: Bearer <token>
Response: { token: string }

// 获取当前用户信息
GET /api/auth/me
Header: Authorization: Bearer <token>
Response: { id, username, nickname, avatar, role, created_at }

// 更新个人设置
PATCH /api/user/profile
Header: Authorization: Bearer <token>
Body: { nickname?: string, avatar?: string }
Response: { user: { id, username, nickname, avatar } }

// 修改密码
POST /api/user/password
Header: Authorization: Bearer <token>
Body: { old_password: string, new_password: string }
Response: { success: true }

// 上传头像
POST /api/user/avatar
Header: Authorization: Bearer <token>
Content-Type: multipart/form-data
Body: file (image/*, max 2MB)
Response: { avatar_url: string }

// ─── 项目 ────────────────────────────────

// 获取我的项目列表（首页用，按 last_active_at 降序）
GET /api/rooms
Header: Authorization: Bearer <token>
Response: { rooms: [{ id, name, description, member_count, online_count, last_active_at, created_at }] }

// 创建项目
POST /api/rooms
Header: Authorization: Bearer <token>
Body: { name: string, description?: string }
Response: { room: { id, name, description, created_at } }

// 获取项目详情
GET /api/rooms/:id
Header: Authorization: Bearer <token>
Response: { room: { ... }, members: [{ ... }] }

// 更新项目设置（仅 owner）
PATCH /api/rooms/:id
Header: Authorization: Bearer <token>
Body: { name?: string, description?: string }
Response: { room: { id, name, description } }

// 删除项目（仅 owner）
DELETE /api/rooms/:id
Header: Authorization: Bearer <token>
Response: { success: true }

// ─── 头像 ────────────────────────────────

// 上传头像（见上方 user/avatar）
// 头像静态文件通过 Fastify 的 fastify-static 插件提供访问
// URL 格式：/avatars/{user_id}.webp
```

### JWT Token 结构

```json
{
  "sub": "usr_abc123",
  "username": "zhangsan",
  "nickname": "张三",
  "role": "user",
  "iat": 1717700000,
  "exp": 1717786400
}
```

Token 有效期 24 小时，过期后用 refresh 接口刷新。

### 认证流程

```
注册/登录:
1. Client → POST /api/auth/login { username, password }
2. Server → 验证密码 → 签发 JWT
3. Client → 存 token 到 localStorage + authStore
4. Client → 跳转首页

WebSocket 连接:
1. Client → ws://host/ws?token=***
2. Server → 验证 token → 提取 user_id
3. Client → { action: "room.join", payload: { room_id: "rm_abc" } }
4. Server → 验证用户是否为房间成员 → 加入房间 → 推送成员列表

路由守卫:
- 未登录访问任何页面 → 重定向到 /login
- 已登录访问 /login → 重定向到 /（首页）
- Token 过期 → 自动 refresh → 失败则跳 /login
```

### Agent 认证

- Agent 使用独立的 token，由管理员通过 REST API 预生成
- Agent 的 `actor.id` 格式：`agent_{name}_{instance}`
- Agent token 中 `role` 字段为 `"ai"`

---

## 页面设计

### 路由表

```
/login          → LoginPage（登录/注册）
/               → HomePage（首页，需登录）
/room/:roomId   → RoomPage（项目室，需登录）
/settings       → SettingsPage（个人设置，需登录）
```

### 首页 (HomePage)

#### 桌面端布局
```
┌───────────────────────────────────────────┐
│  Logo    FreeChat      [搜索]  [头像▼]    │
├───────────────────────────────────────────┤
│                                           │
│  我的项目                     [+ 新建项目] │
│                                           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│  │ 项目A   │ │ 项目B   │ │ 项目C   │     │
│  │         │ │         │ │         │     │
│  │ 3人在线 │ │ 5人在线 │ │ 2人在线 │     │
│  │ 最近活动│ │ 最近活动│ │ 最近活动│     │
│  └─────────┘ └─────────┘ └─────────┘     │
│                                           │
└───────────────────────────────────────────┘
```

#### 移动端布局
```
┌──────────────────┐
│ FreeChat  [头像] │
├──────────────────┤
│ 🔍 搜索项目...   │
├──────────────────┤
│ 我的项目         │
│ ┌──────────────┐ │
│ │ 项目A  3人   │ │
│ │ 最近活动...  │ │
│ └──────────────┘ │
│ ┌──────────────┐ │
│ │ 项目B  5人   │ │
│ └──────────────┘ │
│                  │
│     [+ 新建]     │  ← 浮动按钮
└──────────────────┘
```

#### 项目卡片信息
- 项目名称
- 描述（截断）
- 在线人数（绿点 + 数字）
- 最近活动时间（相对时间，如"5分钟前"）
- 点击进入项目室

### 登录/注册页 (LoginPage)

```
┌──────────────────────────────────┐
│                                  │
│        ┌─────────────┐           │
│        │  FreeChat   │           │
│        │  AI协同办公  │           │
│        └─────────────┘           │
│                                  │
│        [登录] / [注册]           │
│        ┌─────────────┐           │
│        │ 用户名       │           │
│        │ 密码         │           │
│        │ [登录按钮]   │           │
│        └─────────────┘           │
│                                  │
└──────────────────────────────────┘
```

- 居中卡片式布局，移动端全屏
- Tab 切换登录/注册
- 注册额外字段：昵称

### 个人设置页 (SettingsPage)

```
┌──────────────────────────────────┐
│  ← 返回         个人设置         │
├──────────────────────────────────┤
│                                  │
│  头像                            │
│  [当前头像]  [更换]              │
│                                  │
│  昵称                            │
│  [张三____________]              │
│                                  │
│  用户名                          │
│  zhangsan（不可修改）            │
│                                  │
│  [保存修改]                      │
│                                  │
│  ───────────────────             │
│                                  │
│  修改密码                        │
│  旧密码 [____________]           │
│  新密码 [____________]           │
│  确认密码 [____________]         │
│  [更新密码]                      │
│                                  │
│  ───────────────────             │
│                                  │
│  [退出登录]                      │
│                                  │
└──────────────────────────────────┘
```

- 移动端：全屏纵向布局
- 桌面端：居中卡片，最大宽度 640px
- 头像上传支持拍照（移动端）或选择文件

### 前端认证状态管理

```typescript
// stores/authStore.ts
interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  
  // Actions
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, nickname: string) => Promise<void>;
  logout: () => void;
  updateProfile: (data: Partial<User>) => Promise<void>;
  changePassword: (oldPwd: string, newPwd: string) => Promise<void>;
  refreshToken: () => Promise<void>;
}
```

Token 持久化在 `localStorage`，应用启动时自动恢复登录状态。

### 导航结构

```
顶部 Header（所有页面共用）:
├── Logo + 标题
├── 搜索框（首页显示，房间内隐藏）
└── 用户头像下拉菜单
    ├── 个人设置 → /settings
    └── 退出登录 → /login
```

---

## 移动端响应式设计

### 断点策略

```typescript
// tailwind.config.ts
breakpoints: {
  'sm': '640px',   // 手机横屏
  'md': '768px',   // 平板竖屏
  'lg': '1024px',  // 平板横屏/小笔记本
  'xl': '1280px',  // 桌面
}
```

### 布局适配

#### 桌面端 (≥ 1024px)
```
┌─────────────────────────────────────────┐
│ Header                                  │
├──────┬──────────────────────────────────┤
│      │                                  │
│ Side │ Main Content                     │
│ bar  │ (Chat / Files / Tabs / Tasks)    │
│      │                                  │
└──────┴──────────────────────────────────┘
```

#### 移动端 (< 768px)
```
┌─────────────────┐
│ Header + ☰ Menu │
├─────────────────┤
│                 │
│ Main Content    │
│ (Full Screen)   │
│                 │
├─────────────────┤
│ Bottom Tab Nav  │  ← 仅在主视图显示
└─────────────────┘
```

### 核心组件移动端适配

#### 1. 侧边栏
- **桌面端**：固定左侧，宽度 280px
- **移动端**：抽屉式（Drawer），从左侧滑出，点击遮罩关闭
- **实现**：
```tsx
// Sidebar.tsx
<div className={`
  fixed inset-y-0 left-0 z-50 w-72 bg-white transform transition-transform
  md:relative md:translate-x-0 md:w-64
  ${isOpen ? 'translate-x-0' : '-translate-x-full'}
`}>
```

#### 2. 聊天面板
- **桌面端**：主区域或右侧固定宽度
- **移动端**：全屏，输入框固定在底部
- **键盘适配**：监听 `visualViewport.resize` 事件，输入框跟随虚拟键盘上移
```tsx
// ChatInput.tsx
<div className="
  fixed bottom-0 left-0 right-0 bg-white border-t
  pb-[env(safe-area-inset-bottom)]  /* iPhone 底部安全区 */
  md:relative md:border-t-0
">
```

#### 3. Tab 导航
- **桌面端**：顶部水平 Tab 栏
- **移动端**：底部固定 Tab Bar（类似微信），图标 + 文字
```tsx
// BottomNav.tsx (仅移动端可见)
<nav className="
  fixed bottom-0 left-0 right-0 bg-white border-t
  flex justify-around items-center h-16
  pb-[env(safe-area-inset-bottom)]
  md:hidden  /* 桌面端隐藏 */
">
  <NavItem icon={<ChatIcon />} label="聊天" />
  <NavItem icon={<FilesIcon />} label="文件" />
  <NavItem icon={<TabsIcon />} label="面板" />
  <NavItem icon={<TasksIcon />} label="任务" />
</nav>
```

#### 4. 消息列表
- **移动端优化**：
  - 虚拟滚动（react-virtuoso）避免长列表卡顿
  - 左滑消息显示"回复"按钮
  - 长按消息弹出操作菜单（复制、删除、@提及）
```tsx
// MessageList.tsx
<Virtuoso
  data={messages}
  itemContent={(index, msg) => <MessageItem msg={msg} />}
  overscan={200}  // 预渲染 200px
/>
```

#### 5. 文件树
- **移动端**：折叠为列表视图，点击文件全屏预览
- **桌面端**：树形结构 + 右侧编辑区

#### 6. 任务看板
- **桌面端**：多列并排（待认领 / 进行中 / 待审核 / 已完成 / 已取消）
- **移动端**：单列 + 顶部状态 Tab 切换

任务状态机：
```
todo (待认领) → assigned (已分配) → doing (进行中) → done (已完成)
                                              ↓
                                    review (待审核) → done
                                              ↓
                                    doing (打回重做)
                                              ↓
                                    blocked (阻塞) / failed (失败)
```

状态转换规则：
```typescript
const TRANSITIONS = {
  todo:      ['assigned', 'cancelled'],
  assigned:  ['doing', 'todo', 'cancelled'],
  doing:     ['review', 'blocked', 'done', 'failed', 'cancelled'],
  review:    ['done', 'doing', 'cancelled'],
  blocked:   ['doing', 'assigned', 'cancelled'],
  done:      ['todo'],  // 重新打开
  failed:    ['todo', 'doing', 'cancelled'],
  cancelled: ['todo']   // 重新激活
};
```

状态样式：
```typescript
const STATUS_STYLES = {
  todo:      'border-gray-300 bg-white text-gray-600',
  assigned:  'border-blue-300 bg-blue-50 text-blue-700',
  doing:     'border-yellow-400 bg-yellow-50 text-yellow-700',
  review:    'border-purple-300 bg-purple-50 text-purple-700',
  blocked:   'border-red-400 bg-red-50 text-red-700',
  done:      'border-green-400 bg-green-50 text-green-700',
  failed:    'border-red-600 bg-red-100 text-red-800',
  cancelled: 'border-gray-300 bg-gray-100 text-gray-500 opacity-60'
};
```

```tsx
// TaskBoard.tsx
<div className="flex flex-col md:flex-row md:gap-4 overflow-x-auto">
  <TaskColumn status="todo" className="md:flex-1" />
  <TaskColumn status="doing" className="md:flex-1" />
  <TaskColumn status="review" className="md:flex-1" />
  <TaskColumn status="done" className="md:flex-1" />
  <TaskColumn status="cancelled" className="md:flex-1" />
</div>
```

### 触摸交互

| 手势 | 触发区域 | 操作 |
|------|---------|------|
| 左滑 | 消息项 | 显示"回复"按钮 |
| 长按 | 消息项 | 弹出操作菜单 |
| 下拉 | 消息列表 | 刷新/加载更多 |
| 点击 | @标签 | 弹出快捷菜单（回复TA、查看Agent能力） |
| 点击 | 侧边栏遮罩 | 关闭侧边栏 |

### 性能优化（移动端）

1. **虚拟滚动**：消息列表、文件列表使用 `react-virtuoso`
2. **懒加载**：Tab HTML 内容仅在激活时加载到 iframe
3. **图片压缩**：聊天图片自动压缩 + WebP 格式
4. **代码分割**：React.lazy 按路由拆分
```tsx
const FileTree = lazy(() => import('./files/FileTree'));
const TaskBoard = lazy(() => import('./tasks/TaskBoard'));
```

### PWA 支持（可选，Phase 4）

- `manifest.json`：安装到主屏幕
- Service Worker：离线缓存静态资源
- 推送通知：被@时触发浏览器 Notification API

---

## 前端核心流程

### WebSocket 连接与重连

```typescript
// hooks/useWebSocket.ts 核心逻辑
// 1. 连接时携带 token
// 2. 断线指数退避重连 (1s → 2s → 4s → 8s → max 30s)
// 3. 重连后自动 rejoin 当前房间
// 4. 心跳 30s ping，超时判定断连
```

### 消息渲染流程

```
1. wsStore 收到 chat.message → 写入 chatStore.messages
2. MessageList 订阅 chatStore → React 增量渲染
3. MessageItem 解析 mentions → 高亮 @标签
4. 如果 mentions 包含当前用户 → 触发 Toast + 更新未读计数 + 修改 document.title
```

### Tab iframe 安全沙箱

```tsx
// TabContent.tsx
<iframe
  sandbox="allow-scripts allow-same-origin"
  srcDoc={tabHtmlContent}
  referrerPolicy="no-referrer"
  // CSP 通过 srcDoc 内的 <meta> 标签注入
/>
```

---

## 部署方案

### Docker Compose (单节点)

```yaml
version: '3.8'
services:
  freechat:
    build: .
    ports:
      - "3000:3000"    # HTTP API
      - "3001:3001"    # WebSocket (或复用 3000)
    volumes:
      - ./workspace-data:/app/workspace-data
      - ./data:/app/data  # SQLite DB
    environment:
      - JWT_SECRET=***
      - DATA_DIR=/app/workspace-data
      - DB_PATH=/app/data/freechat.db
```

### 生产环境扩展路径

```
当前: 单节点 Fastify + SQLite
  ↓ (如果需要多节点)
阶段2: 多 Fastify 实例 + Redis Pub/Sub (房间消息路由) + SQLite → PostgreSQL
  ↓ (如果需要更高并发)
阶段3: NATS 消息总线 + PostgreSQL + S3 文件存储
```

---

## 开发阶段规划

### Phase 1 - MVP 核心（预估 1-2 周）
- [ ] Monorepo 项目脚手架
- [ ] WebSocket Gateway + 消息路由
- [ ] 聊天模块（发送、历史、广播、@提及）
- [ ] 基础认证（JWT）
- [ ] 前端聊天 UI

### Phase 2 - 工作空间
- [ ] 文件系统 CRUD
- [ ] Tab 动态 UI 引擎
- [ ] 前端文件树 + Tab 渲染

### Phase 3 - 任务系统
- [ ] 任务看板 CRUD
- [ ] 前端看板 UI（拖拽排序）

### Phase 4 - 增强
- [ ] Agent 唤醒机制
- [ ] 离线消息 + 未读提醒
- [ ] 通知系统（浏览器 Notification API）
- [ ] Docker 部署

---

## 待讨论的设计决策

1. **单端口 vs 双端口**：HTTP 和 WebSocket 共用 3000 端口（Fastify 原生支持 upgrade），还是分开？
   - 建议：**共用**，简化部署

2. **文件上传**：小文件走 WebSocket base64（< 5MB），大文件走 REST multipart？
   - 建议：**是**，WebSocket 不适合大文件传输

3. **Tab HTML 的 CSP 策略**：
   - 建议：`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:`
   - 禁止外部请求，只允许内联脚本和样式

4. **@提及的消息格式**：
   - 建议：`content` 中用 `@[user:张三](user_123)` 的 Markdown 扩展语法
   - `mentions` 数组存结构化数据用于检索和通知

5. **SQLite 并发**：better-sqlite3 是同步 API，需要 WAL 模式 + 写入队列避免阻塞
   - 建议：开启 WAL，写操作走 async queue 串行化
