# FreeChat 会话列表与微信式首页设计

## 1. 目标

首页改为类似微信的三栏导航：

```text
[消息] [通讯录] [设置]
```

其中“消息”Tab 混合展示：

- 好友单聊 DM
- 项目房间 Project Room

并支持：

- 最近一条消息
- 未读数
- 置顶
- 免打扰
- 最近会话排序

## 2. 会话类型

第一版支持两类：

```ts
type ConversationType = 'dm' | 'project'
```

### 2.1 DM 单聊

来源：`dm_conversations`

点击进入：

```text
/dm/:conversationId
```

### 2.2 Project 项目房间

来源：`rooms`

点击进入：

```text
/room/:roomId
```

## 3. 会话偏好表

每个用户对每个会话有独立偏好：

```sql
conversation_prefs (
  user_id TEXT NOT NULL,
  conversation_type TEXT NOT NULL, -- dm / project
  conversation_id TEXT NOT NULL,
  pinned INTEGER DEFAULT 0,
  muted INTEGER DEFAULT 0,
  last_read_at INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, conversation_type, conversation_id)
)
```

语义：

- `pinned`: 是否置顶
- `muted`: 是否免打扰
- `last_read_at`: 用户最后读到的时间，用于计算未读数

## 4. 会话列表接口

```http
GET /api/conversations
```

返回：

```ts
{
  conversations: Array<{
    id: string
    type: 'dm' | 'project'
    title: string
    avatar?: string
    subtitle?: string
    lastMessage?: {
      content: string
      actorName: string
      createdAt: number
    }
    lastActiveAt: number
    unreadCount: number
    pinned: boolean
    muted: boolean
    targetPath: string
  }>
}
```

排序规则：

1. `pinned = true` 的会话排前面
2. 同一组内按 `lastActiveAt` 倒序

## 5. 最近一条消息

DM 最近消息来自：

```sql
dm_messages
```

项目最近消息来自：

```sql
messages
```

如果没有消息：

- DM：显示 `@username`
- 项目：显示项目描述或 `项目房间`

## 6. 未读数

DM 未读：

```sql
COUNT(dm_messages.created_at > last_read_at AND actor_id != currentUserId)
```

项目未读：

```sql
COUNT(messages.created_at > last_read_at AND actor_id != currentUserId)
```

免打扰会话仍计算未读，但首页不做强提醒样式；第一版显示灰色未读数。

## 7. 标记已读

进入 DM 或项目房间时调用：

```http
POST /api/conversations/read
{
  "type": "dm" | "project",
  "id": "conversation_id_or_room_id"
}
```

后端更新当前用户该会话的 `last_read_at = Date.now()`。

## 8. 置顶/免打扰

```http
PATCH /api/conversations/:type/:id/prefs
{
  "pinned": true,
  "muted": false
}
```

前端消息列表每个会话项提供快捷按钮：

- 置顶/取消置顶
- 免打扰/取消免打扰

## 9. 首页 UI

### 9.1 消息 Tab

混合展示 DM 和项目：

```text
消息

[私聊] 张三                 未读 2
张三：最近一条消息

[项目] FreeChat             置顶
李四：最近一条项目消息
```

样式区分：

- DM：圆形头像，蓝色“私聊”标签
- Project：方形/圆角项目图标，紫色“项目”标签
- 置顶：淡黄色背景或“置顶”标记
- 免打扰：显示静音图标

### 9.2 通讯录 Tab

包含：

- 搜索用户/添加好友
- 好友申请
- 好友列表

### 9.3 设置 Tab

包含：

- 当前用户卡片
- 个人设置入口
- 退出登录

## 10. 后续扩展

- WebSocket 推送会话列表更新
- 真实最近会话表
- 未读红点聚合
- 会话删除/隐藏
- 普通群聊 conversation
