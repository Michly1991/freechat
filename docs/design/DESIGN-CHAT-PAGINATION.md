# DESIGN-CHAT-PAGINATION

## 目标

房间聊天默认展示最新内容，避免一次性加载大量历史消息影响进入速度和移动端体验。

## 行为

- 进入房间默认加载最新 10 条聊天记录。
- 首次进入/刷新房间后自动滚动到底部，让用户直接看到最新对话。
- 用户向上滑动到聊天容器顶部附近时，按页加载更早消息。
- 每次上滑分页加载 20 条更早消息。
- 加载更早消息后保持当前阅读位置，不跳到底部，也不跳到顶部。
- 如果最新 10 条不足以撑满聊天区域、导致没有可上滑空间，前端会自动继续补一页更早消息，直到出现滚动空间或没有更多历史。
- 运行中的 Agent stream 只在首屏历史请求中随 `chat.history` 恢复，分页加载旧消息时不重复附加。

## 后端协议

### REST

```text
GET /api/rooms/:roomId/messages?limit=10
GET /api/rooms/:roomId/messages?limit=20&before=msg_xxx
```

返回：

```json
{
  "messages": [],
  "hasMore": true
}
```

`hasMore` 由服务端使用 `limit + 1` 查询判断，避免前端猜测。

### WebSocket

```json
{
  "action": "chat.history",
  "payload": { "room_id": "room_xxx", "limit": 10 }
}
```

返回：

```json
{
  "action": "chat.history_result",
  "payload": {
    "messages": [],
    "hasMore": true,
    "before": null
  }
}
```

首屏 `chat.history` 会附加当前房间运行中的 `agent_stream` 临时消息，支持刷新/重进恢复 Agent 处理气泡。

## 前端结构

`RoomPageImpl.tsx` 只保留页面编排和少量跨域 glue code。聊天室相关逻辑按职责拆分，避免单文件接近 500 行后靠压缩代码维持：

- `room-message-pagination.ts`：历史消息分页、滚动位置保持、首屏不足一屏时自动补旧消息。
- `room-diagnostics-controller.ts`：诊断日志订阅、快捷键、复制诊断信息。
- `room-profile-controller.tsx`：成员/Agent 资料弹窗、消息 actor 映射、任务负责人徽标。
- `components/RoomMainPanel.tsx`：按当前 panel 分派渲染聊天/文件/Tab/任务内容。

## 前端滚动策略

- `INITIAL_MESSAGE_LIMIT = 10`
- `OLDER_MESSAGE_PAGE_SIZE = 20`
- 首次消息渲染后执行 `scrollToBottom('auto')`
- `scrollTop < 80px` 且 `hasMoreMessages=true` 时加载旧消息
- 加载前记录：

```ts
prevScrollHeight = el.scrollHeight
prevScrollTop = el.scrollTop
```

- 加载后设置 `suppressNextAutoScrollRef`，避免旧消息插入触发自动置底。
- 加载后恢复：

```ts
el.scrollTop = el.scrollHeight - prevScrollHeight + prevScrollTop
```

## 非目标

- 本阶段不做虚拟列表。
- 本阶段不持久化每个用户的历史阅读滚动位置。
- 本阶段不做“跳到某条搜索结果消息”的定位分页。
