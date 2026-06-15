# DESIGN-AGENT-STREAMING

## 目标

FreeChat Agent 不应只在最终完成后一次性把结果发到聊天室。Agent 有思考、工具调用和执行过程，用户需要持续看到 Agent 正在处理，降低长等待的不确定感。

本设计第一期实现 **处理过程流式**：

- Agent 被触发后立即出现临时 AI 气泡。
- 后端持续广播 Agent 活动事件。
- Agent 调用 `./freechat` 工具时展示工具活动。
- Agent 运行中的活动持久化，刷新/重进房间可恢复正在运行的流式气泡。
- Agent 完成后用最终正式消息替换/收起临时流式气泡，最终消息 payload 保留处理过程，历史里可展开查看。

第一期不展示模型内部 chain-of-thought，也不强依赖 token 级流式输出。

## 当前实现基线

旧链路：

```text
用户消息 -> 触发 Agent -> 等待 Agent Runtime 完整结束 -> 保存 AI 消息 -> 广播 chat.message
```

用户只能看到状态等待，不能看到 Agent 中间处理过程。

## 第一期事件协议

### `agent.stream.started`

Agent 开始处理时广播。前端创建临时消息。

```json
{
  "action": "agent.stream.started",
  "payload": {
    "id": "astream_xxx",
    "agentId": "agent_xxx",
    "actorId": "agent_xxx",
    "actorName": "助理",
    "actorRole": "ai",
    "kind": "agent_stream",
    "status": "streaming",
    "content": "",
    "createdAt": 123,
    "activities": [
      { "text": "收到请求，开始处理", "timestamp": 123 }
    ]
  }
}
```

### `agent.stream.activity`

Agent 运行过程中的可见活动。

```json
{
  "action": "agent.stream.activity",
  "payload": {
    "id": "astream_xxx",
    "agentId": "agent_xxx",
    "text": "正在执行 file.read",
    "tool": "file.read",
    "timestamp": 123
  }
}
```

活动来源：

- Agent Runtime 启动前：`正在调用 Agent Runtime`
- 定时心跳：`仍在处理，已用时 N 秒`，带 `kind='heartbeat'`，前端更新同一条活动而不是每次追加
- Agent Tools 路由：`正在执行 <action>`

### `agent.stream.completed`

Agent 完成。

```json
{
  "action": "agent.stream.completed",
  "payload": {
    "id": "astream_xxx",
    "agentId": "agent_xxx",
    "finalMessageId": "msg_xxx",
    "content": "最终回复"
  }
}
```

随后仍会广播正式的 `chat.message`。前端收到正式消息后移除同 Agent 已完成的临时流式气泡，保留最终落库消息。

如果 Agent 输出 `[SILENT]`，则：

```json
{ "silent": true, "content": "" }
```

前端直接移除临时气泡。

### `agent.stream.failed`

Agent 失败或超时。

```json
{
  "action": "agent.stream.failed",
  "payload": {
    "id": "astream_xxx",
    "agentId": "agent_xxx",
    "error": "timeout"
  }
}
```

前端保留临时气泡，展示失败状态和已有活动。

## 后端实现

新增：

```text
packages/server/src/ws/agent-stream-events.ts
packages/server/src/services/agent-stream.service.ts
```

`agent-stream-events.ts` 维护 `roomId + agentId -> streamMessageId` 的运行时映射，供 `agent-tools` 路由知道当前工具调用属于哪个 Agent 流式气泡。

`agent-stream.service.ts` 负责持久化和读取 Agent stream：

```text
agent_streams         一次 Agent 可见处理流
agent_stream_events   处理活动时间线
```

修改：

```text
packages/server/src/ws/agent-invocation.ts
```

在 `invokeMentionedAgents` 每个 Agent run 内：

1. 广播 `agent.stream.started`
2. 注册 active stream
3. 定时写入并广播 activity 心跳
4. 调用 runtime 前写入并广播 activity
5. 完成时把活动列表写入最终消息 payload，并广播 `agent.stream.completed`
6. silent 时标记 stream 为 `silent` 并移除临时气泡
7. 失败时标记 stream 为 `failed` 并广播 `agent.stream.failed`
8. 清理 active stream 和 timer

修改：

```text
packages/server/src/routes/agent-tools.ts
```

Agent 调用工具时，如果存在 active stream，则写入并广播：

```text
agent.stream.activity: 正在执行 <action>
```

修改：

```text
packages/server/src/ws/gateway.ts
```

`chat.history` 返回历史消息时，如果不是分页 `before` 请求，会把当前房间 `status='streaming'` 的 `agent_stream` 临时消息追加到结果中，支持刷新/重进后恢复正在运行的处理气泡。

## 前端实现

修改：

```text
packages/web/src/pages/room/room-realtime.ts
```

支持新事件：

- `agent.stream.started`：插入临时 `kind='agent_stream'` 消息
- `agent.stream.activity`：追加活动
- `agent.stream.completed`：标记 completed；收到正式 `chat.message` 后移除临时气泡
- `agent.stream.failed`：标记 failed 并显示错误

修改：

```text
packages/web/src/pages/room/components/RoomChatPanel.tsx
```

`agent_stream` 消息使用浅色虚线气泡，展示：

- “正在思考和处理...”
- 最近 6 条活动时间线
- 失败错误

正式 AI 消息如果包含 `payload.agentStream.activities`，在气泡下显示可展开的“处理过程”，用于重进后查看已完成 Agent 的活动摘要。

## 后续第二期

第二期再做 token 级文本流式：

- Claude Code CLI 若支持 `stream-json`，解析 stdout 行事件。
- Provider API 模式走 SSE stream。
- 后端统一转成 `chat.message.delta` 或 `agent.stream.delta`。
- 前端增量更新同一气泡内容。

## 非目标

- 不展示模型内部隐藏推理链。
- 不把 Agent 临时活动落库为普通聊天消息；活动进入专用 `agent_stream_events` 表，最终消息只保留摘要 payload。
- 不改变现有任务驱动多 Agent 协作规则。

## Claude Code stream-json runtime

FreeChat 的默认 server Agent runtime 继续使用 Claude Code CLI，而不是绕过 Claude Code 直接调用模型 Provider API。为避免 `--output-format json` 必须等整轮结束才返回导致长任务被固定总时长超时杀掉，运行时改用：

```bash
claude -p <message> \
  --permission-mode auto \
  --allowedTools 'Bash(./freechat *)' \
  --output-format stream-json \
  --include-partial-messages \
  --verbose
```

后端按 JSONL 解析 stdout：

- `stream_event.content_block_delta.delta.text`：累积为当前流式内容，并通过 WebSocket `agent.stream.delta` 更新正在生成的 Agent 气泡。
- `assistant.message.content` / `result.result`：作为最终回复文本，最终落库为普通 AI 消息。
- `system.status` / `message_start`：写入 Agent stream activity，给用户展示 Claude Code 正在请求或生成。
- `result.session_id`：继续保存到 `agent_sessions`，保留 Claude Code 会话续接能力。

超时策略从单一总时长改为两层：

- `AGENT_IDLE_TIMEOUT_MS`：默认 120000ms。只有 Claude Code 长时间没有任何 stdout/stderr/stream event 时才判定卡死。
- `AGENT_CHAT_TIMEOUT_MS` / `AGENT_TASK_TIMEOUT_MS`：作为 hard timeout 传入单次运行，防止极端情况下进程无限运行。默认聊天 180000ms、任务 600000ms，后续可按业务调大。
- `AGENT_HARD_TIMEOUT_MS` 保留为全局配置备用。

这样保留 Claude Code 的工具、权限、工作区、session 和 `./freechat` CLI 能力，同时让长文本/长任务具备类似流式接口的持续反馈体验。
