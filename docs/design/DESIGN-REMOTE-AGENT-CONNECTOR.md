# Remote Agent Connector / 远程 Agent 连接器

## 目标

远程 Agent 连接器用于把运行在用户/第三方服务器上的 Claude Code Agent 接入 FreeChat。

核心原则：

1. 远程服务器本机安装并配置 Claude Code。
2. FreeChat 不保存远程 Agent 的模型 API Key。
3. 远程 Agent 不是普通真人用户，系统身份仍是 Agent。
4. 远程 Agent 通过短期配对码注册 connector，之后使用本地保存的连接凭证接入。
5. FreeChat 负责事件分发、工具 API、运行记录、状态和账单。

## 和平台托管 Agent 的区别

| 类型 | deployment | Claude Code 运行位置 | 模型 Key | 模型费 | Agent 本身费用 |
| --- | --- | --- | --- | --- | --- |
| 平台托管/中心配置 Agent | `server`/中心配置 | FreeChat 服务端或 Agent Client | FreeChat 模型配置/模型服务 | 由使用方承担，可计费 | 免费 |
| 远程 Claude Agent | `client` | 用户/第三方服务器 | 远程服务器本地配置 | FreeChat 只按 Agent token 服务费结算给 Agent owner，不计算平台模型费 | 默认免费，可配置 per-token |

远程 Agent 的 Claude Code 环境由外部服务器维护，例如：

```bash
claude --version
claude -p "hello"
```

FreeChat 只需要 connector 凭证，不需要 Anthropic/OpenAI/百炼等模型 API Key。

## 配对注册流程

1. 用户用 FreeChat 账号创建/发布 Agent，部署方式可选 `client`。
2. Agent owner 在服务端为该 Agent 生成短期配对码。
3. Agent Client 调用 `POST /api/remote-agents/register` 提交配对码。
4. FreeChat 绑定 connector 到 Agent，返回连接凭证。
5. Client 将凭证保存在本机，只用于该 Agent 的心跳、事件、工具调用和 run 状态上报。
6. 后续同一 Agent 可由客户端控制台继续接管/暂停/恢复接收请求。

配对码只使用一次，并有短有效期。连接凭证不是模型 API Key。Agent Client 的本地登录密码只保护 5188 控制台，不代表业务身份；业务身份始终是保存的 FreeChat Server 账号。Agent 发布方/拥有者可通过服务端的 Agent per-token 计费规则获得 Agent 服务费；客户端托管运行不产生平台模型费。

## 当前协议

当前实现优先 WebSocket 推送，SSE 兜底，最后保留 HTTP polling。三种通道共用 `remote_agent_events`，客户端必须按 `runId` 去重，避免断线重连时重复执行。

### 人类管理端 API

```http
POST /api/agents/:id/connectors/pairing-code
GET /api/agents/:id/connectors
DELETE /api/agents/:id/connectors/:connectorId
```

这些接口需要普通用户 JWT，且仅 Agent owner 可操作。

### 远程客户端 API

```http
POST /api/remote-agents/register
POST /api/remote-agents/heartbeat
GET  /api/remote-agents/events
GET  /api/remote-agents/events/stream
WS   /api/remote-agents/events/ws?token=<connector credential>
POST /api/remote-agents/runs/:runId/activity
POST /api/remote-agents/runs/:runId/complete
POST /api/remote-agents/runs/:runId/fail
```

除注册外，其余接口使用 connector access token 或 connector token。

### 工具 API

复用现有：

```http
POST /api/agent-tools/:roomId
Authorization: Bearer <connector credential>
```

服务端必须校验：

- connector 有效且未撤销；
- Agent 存在并在该 room 中；
- Agent tool permission 允许对应 action；
- 操作继续写入 agent_tool_calls 审计。

## 事件类型

当前事件结构：

```ts
type RemoteAgentEvent = {
  id: string
  runId: string
  roomId: string
  agentId: string
  type: 'agent.mentioned' | 'task.assigned' | string
  payload: { input: string; taskId?: string; subtaskId?: string; runSource?: string }
}
```

触发规则沿用现有 Agent 策略：

- 人类显式 @ Agent；
- 任务/子任务分派给 Agent；
- 默认助理通过任务分派给专家 Agent；
- AI 普通消息不自动触发其他 Agent。

## Run 生命周期

1. FreeChat 决定唤醒远程 Agent。
2. 创建 `agent_runs`：`runtime='remote-claude-code'`，`status='running'`。
3. 创建 `remote_agent_events`。
4. 客户端通过 WebSocket/SSE/polling 收到事件，服务端标记 delivered。
5. 客户端本机调用 Claude Code 或其他本地运行时。
6. 运行时通过 `./freechat` / Agent Tool API 显式回写消息、任务、文件、页面。
7. 客户端调用 complete 或 fail。
8. FreeChat 更新 run、Agent 状态、连接器状态，并触发账单。

重要：远程 Agent Client 的 `complete.output` 只允许更新本 run，服务端用 connector auth 校验 `run.agent_id = auth.agentId`，不能完成/失败其他 Agent 的 run。对于 `agent.mentioned` / `handoff` 这类需要最终聊天回复的 run，服务端会把非 `tool_only/silent` 的 output 落成当前房间中的 Agent 消息；这只发生在该 Agent 已被授权拉取到的 run 上。

Remote connector 权限边界：

- `/api/remote-agents/events` 和 SSE 只返回当前 connector 绑定 Agent 的事件；即使传 `agentIds`，服务端也只允许 `auth.agentId`。
- `/api/remote-agents/runs/:runId/activity|complete|fail` 必须满足 `agent_runs.agent_id = auth.agentId`。
- `/api/remote-agents/knowledge` 只返回 `auth.agentId` 的知识库。
- Connector 是 Agent 执行凭证，不是用户身份；需要操作用户/房间数据时必须走 Agent Tool token 的 actorUserId 授权链。

## 计费

FreeChat 对远程 Agent 继续记录 Token 用量，并按 Agent 服务规则结算：Agent Client 在 complete 时上报 token 账单，服务端按对应 Agent 的收费模式计算 Agent 费给 Agent 创建者；客户端托管运行不计算平台模型费。

- 服务端/平台托管 Agent：`usage_source = server_metered`，`usage_trust_level = trusted`，由服务端直接采集模型 usage。
- Agent Client 托管 Agent：`usage_source = client_reported`，`usage_trust_level = provider_reported`，由 Agent Client 在 `complete` 时上报 Claude Code usage；账单中应明确这是客户端上报，用户和提供方需自行建立信任。

计费规则：

1. Agent 服务费默认 `0`；仅当 `agent_billing_rules.billing_mode='per_token'` 且配置 token 单价后，生成 `agent_usage_charge` / `agent_income`。
2. 使用方是本次 run 的 payer：优先使用触发者 `actorUserId`，分享入口/工作组房间使用进入者；普通项目房间通常是房间创建人。
3. 客户端托管 Agent 不生成 `model_usage_charge` / `model_income`；上报的模型名只用于审计/展示，不用于匹配平台模型规则。
4. 平台/服务端提供的 Agent runtime 才同时计算 Agent 服务费和平台/共享模型费。

Credit 精度统一为 4 位小数。API 以 credit 为单位传输，数据库以 microcredit 整数保存：`1 credit = 10000 microcredits`。每条 run/usage event 保存 `raw_usage_json`、`reported_by_connector_id` 和模型计费快照，便于审计与争议排查。

## 数据表

MVP 新增：

- `agent_connector_pairing_codes`：短期配对码，只存 hash；
- `agent_connectors`：远程连接器注册、状态和心跳；
- `agent_connector_tokens`：连接凭证 hash；
- `remote_agent_events`：远程 Agent 待处理事件队列。

同时确保 `agent_runs.payer_user_id` 存在，便于远程 run 按项目创建人计费。

## 客户端与 SDK 文档

当前正式客户端在独立 workspace：

```text
clients/agent-client/
```

它自带公网可访问的本地控制台、环境检测、账号配置、Agent 管理、上架/下架、托管房间只读视图、请求状态和 WebSocket/SSE/polling 事件处理。若要自行实现第三方客户端，使用单独 SDK 文档：

```text
clients/agent-client/SDK.md
```

历史示例客户端仍可参考：

```text
examples/remote-claude-agent/
```

远程服务器必须自行安装并配置 Claude Code。FreeChat 不接收远程模型 API Key。国内用户如果 Claude Code 不能直连，先在远程服务器本机安装并配置 `cc-switch`，确认 `claude -p "hello"` 成功后再连接 FreeChat。

## 后续增强

- dispatch lease、重投递和更严格幂等；
- 连接器多实例负载均衡；
- 更完整的远程 workspace bundle；
- 更细的 reported token 审计、争议处理和异常用量风控；
- HTTPS/反向代理部署向导和生产安全检查。

## Agent Client 独立控制台

正式客户端放在独立目录：

```text
clients/agent-client/
```

它不是 FreeChat Server 代码，也不是 FreeChat Web 主站代码。三者端口分离：

```text
FreeChat Server: 3001
FreeChat Web:    5173
Agent Client:    5188
```

Agent Client 只连接一个 FreeChat 中心服务器，但可以管理多个 Agent。每个 Agent 仍有自己的 connector credential，客户端本地统一保存并优先用 WebSocket 接收事件。

客户端自带网页/API 控制台，用于管理本客户端：

- 配置中心服务器地址和保存 FreeChat Server 账号；
- 自动登录服务端并只展示当前账号 owner 的 Agent；
- 新建并发布 Agent、上架/下架到市场；
- Agent 列表只做浏览、状态和快捷操作，编辑进入独立 Agent 编辑页；
- 独立 Agent 编辑页维护中心配置，并展示本客户端知识库、工作区和运行规范缓存状态；
- 将 owner Agent 接管到本客户端执行；
- 查看托管房间的只读消息视图；
- 暂停/恢复接收请求；
- 检测 Claude Code、cc-switch、Node 环境；
- 查看本地运行日志和请求状态。

公网访问必须显式开启：

```bash
AGENT_CLIENT_HOST=0.0.0.0
AGENT_CLIENT_PORT=5188
AGENT_CLIENT_ADMIN_PASSWORD='strong-password'
```

若监听 `0.0.0.0` 但没有管理员密码，客户端必须拒绝启动。公网部署推荐通过 Nginx/Caddy/1Panel 反向代理 HTTPS；connector token、access token、模型 Key 等敏感信息不在网页明文展示。

## Agent 迁移原则

FreeChat Server 是唯一中心服务器，但不再承载实际 Agent Runtime：

- 所有 Agent 统一为 `deployment='client'`；即使服务端保存 Agent 记录，也只是中心配置、权限、调度、run、账单和消息。
- 业务 Agent、专家 Agent、自定义 Agent 都由 Agent Client 接管执行。
- 客户端负责本机执行器、工作目录、日志、启停、并发、环境检测和 Agent 知识库。
- Agent 知识库存在客户端上，服务端不默认保存知识库正文；服务端最多保存/展示客户端上报的状态或元数据。

## SSE 推送

Agent Client 优先使用 SSE 接收服务端事件：

```http
GET /api/remote-agents/events/stream
Authorization: Bearer <connector credential>
```

服务端在 `enqueueRun` 创建 `remote_agent_events` 后会立即向对应 Agent 的在线 connector 推送：

```text
event: remote-event
data: { ...RemoteAgentEvent }
```

客户端收到 `remote-event` 后立即处理；原 `GET /api/remote-agents/events` 轮询仍保留为兜底，避免 SSE 断线或代理不支持时丢事件。SSE 连接带 `ping` 心跳，客户端断线后下一轮 tick 会自动重连。

## WebSocket 推送

Agent Client 进一步支持 WebSocket 事件通道，优先级高于 SSE：

```text
ws://<server>/api/remote-agents/events/ws?token=<connector credential>
wss://<server>/api/remote-agents/events/ws?token=<connector credential>
```

消息格式：

```json
{ "type": "ready", "agentId": "..." }
{ "type": "ping", "now": 123 }
{ "type": "remote-event", "event": { "id": "...", "runId": "..." } }
```

客户端优先连接 WebSocket；若当前 Node 运行时或网络代理不支持，则自动退回 SSE；若 SSE 也断开，则保留原 HTTP 轮询兜底。WebSocket/SSE/轮询共用事件去重，避免重复执行同一个 run。

## 托管房间与同名 Agent 兜底

服务端提供：

```http
GET /api/managed-agent-rooms?limit=50
```

该接口返回当前用户拥有且已被 connector 接管的 Agent 所在房间、托管 Agent 列表和 connector 状态，用于 Agent Client 的“托管房间”管理视图。Agent owner 只是 Agent 拥有者，不等于房间成员；因此该接口不返回房间消息内容。若用户同时是房间成员，需要读取消息必须走 `/api/rooms/:roomId/messages`，由房间成员权限单独鉴权。

当 connector 注册或用户把 Agent 加入房间时，服务端会按 `owner_id + name + role_type` 查找已接管版本并迁移/优先使用它，避免房间挂到同名但没有 connector 的副本，导致 `@Agent` 事件一直 pending 无人消费。

## 服务端不再直接启动 Claude Code

当前架构中 FreeChat Server 是中心控制面，不是 Agent Runtime：

- Server 负责 Agent 身份、发布、房间绑定、调度事件、运行记录和计费。
- Server 不再保存或执行本地 Claude Code Runtime，也不再通过 `spawn('claude')` 直接启动 Agent。
- Agent 被唤起时，Server 只创建 `agent_runs` 和 `remote_agent_events`，等待已绑定的 Agent Client 拉取并执行。
- Claude Code、模型配置、本地工具和 Agent 知识库均由 Agent Client 所在机器维护。
- 没有在线 Client 的 Agent 可以被加入房间，但运行事件会保持排队，直到 Client 绑定/上线后处理。
