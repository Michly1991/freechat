# FreeChat 前端页面、移动端与部署设计

> 从 ARCHITECTURE 拆分出的前端页面、响应式、核心流程、部署和阶段规划。

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

## 2026-06-10 RoomPage 大文件拆分

为落实源码单文件大小预算，项目室页面继续从 `RoomPageImpl.tsx` 拆出专题组件与动作工厂：

- `components/RoomChatPanel.tsx`：聊天消息列表、未读标记、输入框与 @ 提及弹层。
- `components/InteractionCard.tsx`：交互请求卡、任务计划预览、选项输入与提交状态。
- `components/RoomFilesPanel.tsx`：文件树、文件编辑器和文件面板布局。
- `components/RoomTabsPanel.tsx`：动态 Tab 顶栏、新建/编辑 Tab 与 iframe 预览。
- `components/RoomTasksPanel.tsx`：任务看板、子任务展开、归档区与任务卡片。
- `components/RoomMembers.tsx`：桌面成员栏、移动端成员抽屉、成员/Agent 资料弹窗。
- `components/RoomShellChrome.tsx`：房间顶部栏、桌面/移动导航、文件弹窗、诊断日志弹窗。
- `room-actions.ts`：文件、Tab、任务的 UI 动作工厂，避免主页面继续堆操作逻辑。
- `room-ui-utils.tsx`：成员/Agent 显示、状态点、头像和消息内容渲染工具。

拆分后 `RoomPageImpl.tsx` 保留页面状态、数据加载、WebSocket 编排和各子组件装配，避免继续承载具体面板 JSX。
