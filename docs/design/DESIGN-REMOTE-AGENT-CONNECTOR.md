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

| 类型 | deployment | Claude Code 运行位置 | 模型 Key | 模型费 | Agent 服务费 |
| --- | --- | --- | --- | --- | --- |
| 平台托管 Agent | `server` | FreeChat 服务端 | FreeChat 模型配置/模型服务 | 可计费 | 可计费 |
| 远程 Claude Agent | `client` | 用户/第三方服务器 | 远程服务器本地配置 | MVP 不计 | 可计费 |

远程 Agent 的 Claude Code 环境由外部服务器维护，例如：

```bash
claude --version
claude -p "hello"
```

FreeChat 只需要 connector 凭证，不需要 Anthropic/OpenAI/百炼等模型 API Key。

## 配对注册流程

1. 用户在 FreeChat 创建 Agent，部署方式选择“外部客户端”。
2. 用户在 Agent 设置页生成短期配对码。
3. 用户在远程服务器运行 remote-claude-agent 示例客户端。
4. 客户端调用 `POST /api/remote-agents/register` 提交配对码。
5. FreeChat 绑定 connector 到 Agent，返回连接凭证。
6. 客户端将连接凭证保存到远程服务器本地。
7. 后续客户端用连接凭证轮询事件、心跳、调用工具、完成 run。

配对码只使用一次，并有短有效期。连接凭证不是模型 API Key。

## MVP 协议

当前 MVP 使用 HTTP 轮询，后续可升级 WebSocket。

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

MVP 事件：

```ts
type RemoteAgentEvent =
  | { type: 'agent.mentioned'; runId: string; roomId: string; input: string }
  | { type: 'task.assigned'; runId: string; roomId: string; input: string; taskId?: string; subtaskId?: string }
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
4. 远程客户端轮询到事件。
5. 客户端本机调用 Claude Code。
6. Claude Code 通过 `./freechat` 调用工具 API 回写消息、任务、文件、页面。
7. 客户端调用 complete 或 fail。
8. FreeChat 更新 run、Agent 状态、连接器状态，并触发账单。

## 计费

MVP 不收远程模型费。原因：模型调用发生在远程服务器，FreeChat 无法验证真实 token 和成本。

MVP 支持远程 Agent 服务费：

```text
项目创建人 debit agent_usage_charge
Agent 提供者 credit agent_income
```

推荐模式：

- `free`：私有/内部 Agent；
- `per_run_fixed`：每次成功完成 run 收固定 Agent 服务费。

后续可加 `reported_token`，但必须在账单中明确“由外部 Agent 上报，平台未验证”。

## 数据表

MVP 新增：

- `agent_connector_pairing_codes`：短期配对码，只存 hash；
- `agent_connectors`：远程连接器注册、状态和心跳；
- `agent_connector_tokens`：连接凭证 hash；
- `remote_agent_events`：远程 Agent 待处理事件队列。

同时确保 `agent_runs.payer_user_id` 存在，便于远程 run 按项目创建人计费。

## 远程客户端模板

代码库包含示例：

```text
examples/remote-claude-agent/
```

部署步骤：

```bash
pnpm install
pnpm build
node dist/index.js pair --server http://freechat.example.com --code ABCD-1234
node dist/index.js connect
```

远程服务器必须自行安装并配置 Claude Code。FreeChat 不接收远程模型 API Key。

示例客户端提供自检脚本：

```bash
pnpm run check:claude   # 检查 claude，国内用户提示 cc-switch
pnpm run smoke:claude   # 创建临时工作区，验证本机 claude -p 能按连接器方式执行
```

国内用户经验：如果 Claude Code 不能直连，先在远程服务器本机安装并配置 `cc-switch`，确认 `claude -p "hello"` 成功后再连接 FreeChat。

## 后续增强

- WebSocket/SSE 推送替代轮询；
- dispatch lease、重投递和幂等；
- 连接器多实例负载均衡；
- 更完整的远程 workspace bundle；
- reported token 计费和审计；
- 前端连接状态、配对码、接入教程完整 UI。
