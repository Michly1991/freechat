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

## 后续细节拆分

为控制单文件大小，数据库设计、消息保留、日志方案 已拆分到：

- [ARCHITECTURE-DATA.md](./ARCHITECTURE-DATA.md)
