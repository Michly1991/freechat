# FreeChat 好友与单聊系统设计

## 1. 背景

FreeChat 原有模型以项目房间 `room` 为核心，适合多人项目协作，但不适合表达：

- 用户之间建立好友关系
- 两个好友之间单独聊天
- 首页从好友列表发起单聊
- 创建项目时从好友中选择成员

因此新增第一版好友系统和 DM 单聊系统。

## 2. 第一版范围

第一版实现：

1. 用户搜索
2. 发送好友申请
3. 接受/拒绝好友申请
4. 好友列表
5. 首页展示好友、好友申请、项目
6. 点击好友打开单聊
7. 单聊最近 100 条消息
8. 单聊浏览器 localStorage 缓存最近 100 条
9. 新建项目时可勾选好友加入项目

第一版暂不做：

- 好友分组
- 拉黑
- 已读回执
- 普通非项目群聊
- 好友资料页

## 3. 数据库设计

### 3.1 好友申请表

```sql
friend_requests (
  id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  message TEXT,
  status TEXT NOT NULL, -- pending / accepted / rejected
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

约束：

- 不能给自己发申请。
- 已经是好友时不能重复申请。
- 对同一目标存在 pending 申请时不能重复申请。

### 3.2 好友关系表

```sql
friendships (
  user_id TEXT NOT NULL,
  friend_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, friend_id)
)
```

接受申请时写入双向关系：

```text
A -> B
B -> A
```

### 3.3 单聊会话表

```sql
dm_conversations (
  id TEXT PRIMARY KEY,
  user_a_id TEXT NOT NULL,
  user_b_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL
)
```

规则：

- 两个用户之间只有一个 DM 会话。
- 存储时按用户 ID 排序，保证 `(user_a_id, user_b_id)` 唯一。

### 3.4 单聊消息表

```sql
dm_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  content TEXT NOT NULL,
  edited_at INTEGER,
  deleted INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
)
```

每个 DM 会话保留最近 100 条未删除消息。

## 4. 后端接口

### 4.1 搜索用户

```http
GET /api/users/search?q=xxx
```

返回 friendStatus：

```ts
'none' | 'pending_sent' | 'pending_received' | 'friends' | 'self'
```

### 4.2 发送好友申请

```http
POST /api/friends/requests
{
  "targetUserId": "usr_xxx",
  "message": "你好"
}
```

### 4.3 查看好友申请

```http
GET /api/friends/requests
```

返回：

- received：我收到的 pending 申请
- sent：我发出的 pending 申请

### 4.4 处理好友申请

```http
POST /api/friends/requests/:id/accept
POST /api/friends/requests/:id/reject
```

### 4.5 好友列表

```http
GET /api/friends
```

### 4.6 打开单聊

```http
POST /api/dm/open
{
  "userId": "usr_xxx"
}
```

返回 DM conversation。

### 4.7 单聊历史

```http
GET /api/dm/:conversationId/messages?limit=100
```

### 4.8 发送单聊消息

```http
POST /api/dm/:conversationId/messages
{
  "content": "你好"
}
```

第一版 DM 消息使用 REST 发送；后续可升级为 WebSocket。

## 5. 前端设计

### 5.1 首页布局

首页分为：

1. 消息会话列表
2. 通讯录：好友搜索、好友申请、好友列表、Agent、场景
3. 设置入口
4. 右上角 `+` 快捷菜单

右上角 `+` 快捷菜单提供：

- 添加好友：打开添加好友弹窗，复用用户搜索与好友申请 API
- 加入项目：打开邀请码加入弹窗
- 新建项目：打开新建项目弹窗

添加好友弹窗在桌面端居中展示，在移动端使用底部弹层；支持输入用户名/昵称搜索、展示好友状态，并发送好友申请。

好友列表中的好友项提供：

- 头像
- 昵称/用户名
- 发消息按钮

点击发消息进入单聊页。

### 5.2 单聊页

路径：

```text
/dm/:conversationId
```

展示：

- 对方昵称和头像
- 消息列表
- 输入框

消息左右布局规则与房间聊天一致：

- 自己消息右侧
- 对方消息左侧
- 头像显示在气泡旁

### 5.3 单聊本地缓存

localStorage key：

```text
freechat:dm:{conversationId}:messages
```

缓存最近 100 条。

进入单聊时：

1. 先读本地缓存立即渲染
2. 再拉服务端最近 100 条
3. 合并去重排序
4. 写回缓存

### 5.4 创建项目选择好友

新建项目弹窗增加好友选择区域：

```text
添加好友成员
[ ] 张三
[ ] 李四
```

创建项目后，后端把选中的好友加入 `room_members`，角色默认为 `editor`。

## 6. 权限规则

- 只有好友之间可以打开单聊。
- 只有 DM 双方可以读取/发送 DM 消息。
- 创建项目时只能选择自己的好友作为初始成员。

## 7. 后续扩展

- WebSocket DM 实时推送
- 最近会话列表
- 未读数
- 已读回执
- 普通群聊 conversation
- 好友资料页
