# FreeChat Agent Client SDK 接入文档

本文面向想自己实现 FreeChat Agent Client 的开发者。官方 `clients/agent-client` 是一个参考实现：它用本地 Claude Code 执行 Agent，请求来自 FreeChat Server，结果和工具调用写回 FreeChat。

> 当前版本：MVP / `0.1.0`。协议字段后续可以扩展，但已有字段会尽量保持兼容。

## 1. 架构角色

```text
FreeChat Web / Server
        │
        │  @Agent / 任务分派
        ▼
Remote Agent Event Queue
        │  WebSocket / SSE / Polling
        ▼
Agent Client SDK / Runtime
        │  本地模型、Claude Code、工具执行
        ▼
FreeChat Server Agent Tools / Run APIs
```

### FreeChat Server

- 保存用户、房间、消息、Agent、任务和计费记录。
- 生成 Agent Connector 配对码。
- 接收 Agent Client 心跳。
- 推送远程 Agent 事件。
- 接收运行完成/失败/活动记录。

### Agent Client

- 运行在 Agent 提供方自己的机器上。
- 保存 connector credential。
- 连接一个 FreeChat Server。
- 可以托管多个 Agent。
- 通过 WebSocket/SSE/polling 接收请求。
- 使用本地模型或 Claude Code 执行。
- 通过 Agent Tools 写回聊天、任务、文件等结果。

## 2. 认证模型

Agent Client 有两类凭证：

| 凭证 | 用途 | 保存位置 |
| --- | --- | --- |
| FreeChat 用户 token | 管理/创建/上架/接管 Agent | Client 本地配置 |
| Agent connector accessToken | 接收事件、心跳、完成 run、调用工具 | 每个托管 Agent 的 credential |

注意：

- Client 控制台密码只保护本地管理页面，不是业务身份。
- Agent 发布方/收费方是 FreeChat Server 上的 Agent owner。
- Client 不应创建独立业务用户体系。
- Client 不应把本地模型 API Key 上传到 FreeChat Server。

## 3. 配对注册流程

### 3.1 服务端创建配对码

通常由 FreeChat Web 或 Agent Client 管理台调用服务端管理 API 创建配对码。

```http
POST /api/agents/:agentId/connectors/pairing-code
Authorization: Bearer <FreeChat user token>
```

返回示意：

```json
{
  "success": true,
  "data": {
    "code": "PAIR-xxxx",
    "expiresAt": 1780000000000
  }
}
```

### 3.2 Client 注册 connector

```http
POST /api/remote-agents/register
Content-Type: application/json
```

请求体：

```json
{
  "pairingCode": "PAIR-xxxx",
  "instanceId": "host-12345",
  "name": "my-agent-client",
  "clientVersion": "0.1.0",
  "capabilities": {
    "runtime": "claude-code",
    "localClaudeCode": true,
    "multiAgentClient": true,
    "webConsole": true
  }
}
```

返回：

```json
{
  "success": true,
  "data": {
    "agentId": "agent_xxx",
    "connectorId": "aconn_xxx",
    "accessToken": "...",
    "connectorToken": "..."
  }
}
```

SDK 应保存 `agentId`、`connectorId`、`accessToken`。后续 connector API 使用：

```http
Authorization: Bearer <accessToken>
```

## 4. 心跳

```http
POST /api/remote-agents/heartbeat
Authorization: Bearer <accessToken>
Content-Type: application/json
```

请求体：

```json
{
  "capabilities": {
    "runtime": "claude-code",
    "localClaudeCode": true,
    "version": "0.1.0",
    "multiAgentClient": true,
    "clientName": "my-agent-client",
    "agentCount": 3
  }
}
```

建议：

- 每 15-30 秒发送一次。
- 心跳失败不要立刻删除凭证，先重试。
- 多 Agent Client 应对每个托管 Agent 分别保持连接/心跳。

## 5. 接收事件

事件优先级：

1. WebSocket
2. SSE
3. HTTP polling

### 5.1 WebSocket 推荐

URL：

```text
ws://<server>/api/remote-agents/events/ws?token=<accessToken>
wss://<server>/api/remote-agents/events/ws?token=<accessToken>
```

服务端 ready 消息：

```json
{
  "type": "ready",
  "agentId": "agent_xxx"
}
```

事件消息：

```json
{
  "type": "remote-event",
  "event": {
    "id": "raevt_xxx",
    "runId": "arun_xxx",
    "roomId": "room_xxx",
    "agentId": "agent_xxx",
    "type": "agent.mentioned",
    "payload": {
      "input": "@法务专家 请审查这个合同",
      "taskId": "task_xxx",
      "subtaskId": "subtask_xxx",
      "runSource": "agent.mentioned"
    }
  }
}
```

心跳帧：

```json
{ "type": "ping", "now": 1780000000000 }
```

Client 可以忽略，或发送：

```json
{ "type": "ping" }
```

服务端会回：

```json
{ "type": "pong", "now": 1780000000000 }
```

### 5.2 SSE fallback

```http
GET /api/remote-agents/events/stream
Authorization: Bearer <accessToken>
Accept: text/event-stream
```

事件格式：

```text
event: remote-event
data: {"id":"raevt_xxx","runId":"arun_xxx",...}
```

### 5.3 Polling fallback

```http
GET /api/remote-agents/events?limit=5
Authorization: Bearer <accessToken>
```

可选 query：

```text
agentIds=agent_a,agent_b
```

返回：

```json
{
  "success": true,
  "data": {
    "events": []
  }
}
```

## 6. RemoteEvent 数据结构

TypeScript 参考：

```ts
export type RemoteEvent = {
  id: string
  runId: string
  roomId: string
  agentId: string
  type: string
  payload: {
    input: string
    taskId?: string
    subtaskId?: string
    runSource?: string
  }
}
```

常见 `type` / `runSource`：

| 值 | 含义 |
| --- | --- |
| `agent.mentioned` | 人类在房间里 @ 了该 Agent |
| `task.assigned` | 任务或子任务分派给该 Agent |
| `assistant.delegated` | 助理通过任务/工具分派 |

事件投递语义：

- Server 在事件被取走/推送时标记 delivered。
- Client 应保证同一个 `runId` 只执行一次。
- 如果连接断开，未完成事件可通过 fallback 再恢复。

## 7. 执行事件

推荐处理流程：

```ts
async function handleEvent(event: RemoteEvent) {
  try {
    await reportActivity(event.runId, 'started')
    const output = await runLocalAgent(event.payload.input, event)
    await completeRun(event.runId, { output, summary: output.slice(0, 500) })
  } catch (err) {
    await failRun(event.runId, err)
  }
}
```

重要约定：

- 如果要回复用户，必须调用 Agent Tool `chat.send`。
- 不建议 SDK 自动把模型 stdout 再发一遍，否则会和 Agent 主动发送重复。
- `completeRun` 的 `output` 是运行记录/摘要，不等于聊天回复。

## 8. Run 状态 API

### 8.1 活动记录

```http
POST /api/remote-agents/runs/:runId/activity
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{ "text": "正在读取房间上下文" }
```

### 8.2 完成

```http
POST /api/remote-agents/runs/:runId/complete
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "summary": "已完成合同风险初审",
  "output": "详细运行摘要...",
  "usage": {
    "model": "qwen3.7-max",
    "inputTokens": 1000,
    "outputTokens": 500,
    "totalTokens": 1500
  }
}
```

### 8.3 失败

```http
POST /api/remote-agents/runs/:runId/fail
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{ "error": "本地 Claude Code 执行失败" }
```

## 9. Agent Tools

Agent Client 通过 Agent Tool API 操作房间资源。

```http
POST /api/agent-tools/:roomId
Authorization: Bearer <accessToken>
Content-Type: application/json
```

请求体：

```json
{
  "action": "chat.send",
  "args": {
    "content": "这是 Agent 回复"
  }
}
```

常用 action：

| action | 用途 |
| --- | --- |
| `chat.send` | 发送房间消息 |
| `members.list` | 查询房间成员/Agent |
| `room.info` | 查询房间信息 |
| `task.list` | 查询任务 |
| `task.progress` | 写任务进度 |
| `file.read` / `file.list` | 读取用户可见项目文件 |
| `file.write` / `file.write-local` | 写用户可见项目文件 |
| `tab create/update/delete` | 管理用户可见页面 |

具体 action 参数以 FreeChat Server 当前 `agent-tools` 实现为准。

## 10. 最小 Node SDK 示例

```ts
const serverUrl = 'http://127.0.0.1:3001'
const accessToken = process.env.FREECHAT_AGENT_ACCESS_TOKEN!

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(serverUrl + path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  })
  const data = await res.json()
  if (!res.ok || data.success === false) throw new Error(data.error?.message || res.statusText)
  return data.data ?? data
}

async function sendChat(roomId: string, content: string) {
  return api(`/api/agent-tools/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    body: JSON.stringify({ action: 'chat.send', args: { content } }),
  })
}

async function complete(runId: string, output: string) {
  return api(`/api/remote-agents/runs/${encodeURIComponent(runId)}/complete`, {
    method: 'POST',
    body: JSON.stringify({ output, summary: output.slice(0, 500) }),
  })
}

async function fail(runId: string, err: unknown) {
  return api(`/api/remote-agents/runs/${encodeURIComponent(runId)}/fail`, {
    method: 'POST',
    body: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
  })
}

async function pollOnce() {
  const { events } = await api('/api/remote-agents/events?limit=5')
  for (const event of events) {
    try {
      const reply = `收到请求：${event.payload.input}`
      await sendChat(event.roomId, reply)
      await complete(event.runId, reply)
    } catch (err) {
      await fail(event.runId, err)
    }
  }
}
```

## 11. 本地控制台 API

官方 Agent Client 还提供本地控制台 API，路径前缀为：

```text
/api/local
```

这些 API 只用于管理本地客户端，不是远程 Agent 协议的一部分。

| API | 用途 |
| --- | --- |
| `POST /api/local/login` | 登录客户端控制台 |
| `GET /api/local/state` | 查看本地配置/运行状态，敏感字段会脱敏 |
| `PATCH /api/local/config` | 更新本地配置 |
| `POST /api/local/server/login` | 登录 FreeChat Server 账号 |
| `POST /api/local/server/auto-login` | 使用已保存账号自动登录 Server |
| `GET /api/local/server/agents` | 列出当前账号 owner Agent |
| `POST /api/local/server/agents` | 创建并发布 Agent |
| `PATCH /api/local/server/agents/:id` | 编辑/上架/下架 Agent |
| `POST /api/local/server/agents/:id/bind` | 接管 Agent 到本客户端 |
| `GET /api/local/server/managed-rooms` | 查看托管房间 |
| `POST /api/local/worker/start` | 开始接收请求 |
| `POST /api/local/worker/stop` | 暂停接收请求 |

## 12. 安全建议

- 公网开放 Agent Client 控制台时必须设置强密码。
- 生产环境建议使用 HTTPS 反向代理。
- connector `accessToken` 只能保存在本地安全配置中，不能提交到 Git。
- 不要把本地模型 API Key 上传到 FreeChat Server。
- 日志中不要打印完整 token、密码、API Key。
- 同一个 `runId` 要做幂等保护，避免断线重连后重复执行。
- 聊天回复只通过 `chat.send` 显式发送，避免 stdout 自动二次发送。

## 13. 错误处理建议

| 场景 | 建议 |
| --- | --- |
| `401 UNAUTHORIZED` | connector token 失效，提示重新接管/配对 |
| WebSocket 断开 | 自动切 SSE，失败后 polling |
| 运行超时 | 调用 fail 或 activity 说明当前状态 |
| 工具调用失败 | 将错误写入 run fail，并在必要时 `chat.send` 告知用户 |
| 本地模型不可用 | 环境检查失败，暂停接收请求 |

## 14. 实现清单

最小可用 SDK/Client 需要：保存 serverUrl/Agent credential；注册或导入 connector；周期性 heartbeat；通过 WebSocket/SSE/polling 接收事件；按 `runId` 去重和控制并发；执行本地模型/脚本；通过 Agent Tools 显式发送聊天、写文件、更新任务；上报 complete/fail/activity；提供本地日志和环境检查。
