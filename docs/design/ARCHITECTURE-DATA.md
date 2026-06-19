# ARCHITECTURE DATA

> 从 ARCHITECTURE.md 拆分出的数据库设计、消息保留、日志方案。


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
  identity_type TEXT DEFAULT 'human', -- human | agent；账号身份性质，不等同权限 role
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

## 认证、前端与部署细节拆分

为控制架构文档体积，认证、Agent 认证以及前端/部署索引已拆分到：

- [ARCHITECTURE-AUTH.md](./ARCHITECTURE-AUTH.md)
- [ARCHITECTURE-FRONTEND.md](./ARCHITECTURE-FRONTEND.md)
