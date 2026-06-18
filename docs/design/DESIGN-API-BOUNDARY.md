# DESIGN-API-BOUNDARY

## 目标

FreeChat 的 API 分层遵循：

- **WebSocket 只承载聊天室实时通道和服务端广播事件**。
- **业务操作使用 REST HTTP API**。

这样可以避免把任务、Agent 管理、文件、Tab 等业务动作混在 WS RPC 里，降低调试和权限控制复杂度。

## WebSocket 边界

### 允许的 client -> server action

```text
room.join
room.leave
chat.send
chat.history
chat.edit
chat.delete
chat.typing
```

这些都属于聊天室实时会话本身。

### 允许的 server -> client broadcast

```text
chat.message
chat.history_result
chat.edited
chat.deleted
chat.typing_update
room.member_join
room.member_leave
room.online_update
room.members_update

agent.status_update
agent.stream.started
agent.stream.activity
agent.stream.completed
agent.stream.failed

task.changed
files.updated
tabs.updated
interaction.created
interaction.updated
```

注意：`task.changed` 是广播事件，不是任务操作 API。任务操作本身走 REST，服务端完成后通过 WS 广播变更以同步其他在线客户端。

## REST 边界

以下业务动作使用 REST：

- 任务 CRUD / retry
- 子任务 CRUD / retry
- Agent 添加、移除、重启、调用
- 成员添加、邀请、退出
- 文件读写、上传、删除、建目录
- Tab 创建、更新、删除、排序
- 交互卡响应、消费、取消
- 好友、私聊、会话偏好
- 用户设置
- AI 配置
- 场景、模板、权限

## 当前落地

前端任务操作已从 WS 迁移到 REST：

```text
POST   /api/rooms/:id/tasks
PATCH  /api/rooms/:id/tasks/:taskId
DELETE /api/rooms/:id/tasks/:taskId
POST   /api/rooms/:id/tasks/:taskId/retry
POST   /api/rooms/:id/tasks/:taskId/subtasks
PATCH  /api/rooms/:id/tasks/:taskId/subtasks/:itemId
DELETE /api/rooms/:id/tasks/:taskId/subtasks/:itemId
POST   /api/rooms/:id/tasks/:taskId/subtasks/:itemId/retry
```

Agent 重启已从 WS 迁移到 REST：

```text
POST /api/rooms/:roomId/agents/:agentId/restart
Body: { clearSession?: boolean, mode?: 'soft' | 'force' }
```

- `mode` 默认 `soft`，仍保留 running-run 防护，避免双进程并发。
- `mode='force'` 用于人工处理卡死 Agent：服务端会中断当前 Claude Code runtime，取消 running run，清理会话后恢复在线。

WS gateway 已移除 `task.*` 和 `agent.restart` 的 client action 入口。

## 非目标

- 不移除 WS 广播事件。
- 不要求聊天消息发送改成 REST；聊天室实时消息仍走 WS，HTTP 发送只作为断线 fallback。
- 不改变 Agent Tools 内部协议；Agent Tools 是 Agent 内部 App Tool API，不是浏览器 UI 的 WS RPC。
