# Agent Tool Router 统一设计草案

## 背景

FreeChat 已经把“小蜜/Agent 代替界面操作”的能力抽象成 Assistant App Tools，并引入 `app-actions/registry.ts` 与 `app-actions/executor.ts`。随着文件、Office、图片、知识库、脑图、账单、Agent 管理、远程 Agent HTTP 网关等能力增加，当前工具执行链开始出现重复分发和权限策略分散的问题。

现状中主要入口包括：

- `/api/agent-tools/:roomId`：兼容旧 Agent Tool token 入口。
- `/api/remote-agents/app-call`：Remote Agent Connector HTTP 网关。
- 平台托管小蜜运行时：模型输出 inline `<toolcall>` 后由服务端执行。
- `executeLocalAgentTool`：本地处理器链分发。
- `executeAppAction`：界面功能级 App Action 分发。
- `handleAppUiTool`：仍保留一部分工具清单、会话、好友、DM、用户查询等 UI 工具。

这些链路大多会回到同一批 service/DB 逻辑，但目前分发、权限、风险、审计、参数校验和结果格式化不够集中。后续如果继续新增工具，容易出现“某个入口能用、另一个入口漏权限或漏审计”的回归。

## 目标

1. **统一入口语义**：inline、Remote HTTP、旧 `/api/agent-tools`、CLI wrapper、小蜜平台托管最终都进入同一套 Tool Router。
2. **Registry 即事实来源**：工具元数据、handler、风险等级、参数规范、权限策略尽量集中登记。
3. **服务端权限兜底**：前端隐藏按钮、Agent prompt、CLI 文案都不能作为安全边界；Tool Router 和领域 service 必须双层校验。
4. **风险策略可执行**：`read / normal_write / sensitive_write / dangerous / blocked` 不只用于展示，也影响执行策略。
5. **审计一致**：所有 Agent/App Tool 调用都能写入 `agent_tool_calls`，并能关联 `agent_runs` / stream activity。
6. **兼容迁移**：保持现有 action 名、CLI 和 Remote HTTP 协议可用，逐步迁移 handler，不做大爆炸重写。
7. **结果可读**：服务端返回结构化结果，运行时可选用 formatter 生成给 Agent 的短摘要，避免把大 JSON 原样塞回模型。

## 非目标

- 不重新设计 REST API。
- 不把 Web 前端直接改成走 Tool Router；前端仍优先调用现有 REST API，Tool Router 面向 Agent/App Tools。
- 不允许 Tool Router 绕过领域 service 权限；Router 是统一入口，不是超级权限通道。
- 不在第一阶段引入复杂 DSL 或外部权限引擎。

## 当前问题清单

### 1. 分发分散

当前一类 action 可能出现在多个地方：

- `registry.ts` 记录工具清单和风险文案。
- `executor.ts` 实际处理部分 App Action。
- `agent-tools.app-ui.ts` 处理另一批 UI/会话/好友/DM 工具。
- `agent-tools-dispatch.ts` 以处理器链方式分派 file/tab/task/admin/appAction。
- `inline-agent-tool.service.ts` 又维护了一份工具结果格式化。
- `platform-hosted-agent-runtime.service.ts` 对附件 auto-read 又做了一份结果格式化。

这会导致新增 action 时容易漏：

- registry 有了但 executor 没有。
- executor 支持了但 tool.list/CLI 没暴露。
- HTTP 路径有审计，inline 路径审计不一致。
- formatter 重复，输出风格不一致。

### 2. 风险等级没有统一 gate

`AppActionMeta.risk` 已存在，但执行时主要依赖 handler 内部校验。这样短期可用，长期容易出现敏感写操作遗漏确认策略。

### 3. actor/scope 语义容易漂移

关键字段包括：

- `agentId`：执行工具的 Agent 身份。
- `actorUserId`：本次工具操作代表的用户，是权限主体。
- `roomId`：当前 Agent run 所属房间或入口房间。
- `scopeRoomId`：小蜜代操作的目标房间。
- `runId`：用于恢复 actor、关联审计和结算。
- `connector owner`：只能作为远程执行器归属，不应天然成为业务授权主体。

这些语义必须集中固化，避免某个入口退回到系统账号或 Agent owner 造成越权。

### 4. 审计和 activity 关联不完整

`agent_tool_calls` 目前主要围绕 `/api/agent-tools/:roomId` / remote tool call 路径记录。inline 自动工具调用、平台托管 auto-read、appAction 内部嵌套调用应当尽量统一记录或明确标记为同一次调用的子步骤。

## 目标架构

### 总览

```text
Agent / 小蜜 / Remote Client / CLI
        |
        | normalize transport/auth/body
        v
ToolRequestAdapter
        |
        | builds ToolExecutionContext
        v
ToolRouter.execute(ctx, action, args)
        |
        +--> Registry lookup
        +--> Tool permission gate
        +--> Risk policy gate
        +--> Parameter validation
        +--> Audit start(agent_tool_calls)
        +--> Handler execute(domain service)
        +--> Audit finish + stream activity
        +--> Normalize response + optional summary
```

### 核心对象

```ts
export type ToolTransport =
  | 'legacy-agent-tools'
  | 'remote-app-call'
  | 'platform-inline'
  | 'platform-auto-read'
  | 'agent-cli'
  | 'server-internal'

export interface ToolExecutionContext {
  roomId: string
  scopeRoomId?: string
  agentId: string
  actorUserId: string
  actorRole?: string
  runId?: string
  streamId?: string
  connectorId?: string
  transport: ToolTransport
  recordPreview?: boolean
  emitActivity?: (tool: string) => void
}

export interface ToolHandlerResult<T = unknown> {
  success: boolean
  data?: T
  message?: string
  error?: { code: string; message: string; details?: unknown }
}

export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  action: string
  title: string
  category: string
  risk: AppActionRisk
  description: string
  aliases?: string[]
  args?: Record<string, string>
  ui?: string
  permissions?: ToolPermissionPolicy
  validate?: (args: unknown) => TArgs
  handler: (ctx: ToolExecutionContext, args: TArgs) => Promise<ToolHandlerResult<TResult>>
  summarize?: (result: ToolHandlerResult<TResult>) => string
}
```

> 第一阶段可以不引入新依赖；`validate` 用手写函数即可。后续如果表单/API schema 也复用，可评估 Zod 或 TypeBox。

## Registry 设计

### 单一事实来源

`packages/server/src/app-actions/registry.ts` 从“纯元数据数组”升级为“定义注册表”：

- 元数据：`action/title/category/risk/description/args/ui/aliases`。
- 执行 handler：可直接绑定，也可懒加载领域 handler。
- 参数校验：轻量 `validate(args)`。
- 权限策略：声明 action 所需的基础权限。
- 结果摘要：`summarize(result)`，供 Agent 二次整理前使用。

为了避免单文件过大，建议拆分：

```text
packages/server/src/app-actions/
  registry.ts              # 聚合 register/list/get
  types.ts                 # ToolDefinition/Context/Result 类型
  router.ts                # ToolRouter
  risk-policy.ts           # risk gate
  summaries.ts             # 通用摘要
  handlers/
    system.handlers.ts
    chat.handlers.ts
    room.handlers.ts
    task.handlers.ts
    file.handlers.ts
    office.handlers.ts
    tab.handlers.ts
    member.handlers.ts
    agent.handlers.ts
    knowledge.handlers.ts
    billing.handlers.ts
    model.handlers.ts
    mindmap.handlers.ts
```

### action 命名规则

保留现有命名：

- `domain.verb`：`file.read`、`agent.detail`。
- 多级领域保留：`agent.knowledge.search`、`agent.model.get`。
- 兼容别名集中放 `aliases`：如 `agent.my_list` -> `agent.my-list`、`tool.help` -> `tool.schema`。

Router 先 canonicalize：

```text
raw action/tool/name -> trim -> alias lookup -> canonical action
```

### app.call/tool.call

`app.call` / `tool.call` 继续作为代理入口，但不应绕过 gate：

1. 校验 target 非空。
2. 禁止嵌套 `app.call` / `tool.call`。
3. 合并 `scopeRoomId`：`args.roomId || args.scopeRoomId || nextArgs.roomId || nextArgs.scopeRoomId || ctx.scopeRoomId`。
4. 递归调用 `ToolRouter.execute({ ...ctx, scopeRoomId }, target, nextArgs)`。
5. 审计上可以记录两种方式之一：
   - 只记录 target action，`app.call` 作为 transport detail；推荐。
   - 或记录 parent/child tool call；后续如果需要调用链可扩展 `parent_tool_call_id`。

## 权限模型

### 基础原则

- `actorUserId` 是业务授权主体。
- `agentId` 是执行主体，用于工具权限、Agent 是否在房间、审计和账单。
- `connector credential` 只证明远程执行器身份，不代表用户授权。
- `scopeRoomId` 不为空时，所有房间级资源读写都以 `scopeRoomId` 为目标房间，并校验 actor 是目标房间成员。
- 小蜜不能因系统内置身份获得更高业务权限。

### Router 层通用校验

1. `agentId` 必须存在。
2. 房间级执行：Agent 必须在入口房间或目标房间中，除非 action 明确是用户级能力（例如账单/通讯录 Agent）。
3. `actorUserId` 必须存在；没有 actor 的工具调用拒绝。
4. 如果传入 `scopeRoomId`：
   - actor 必须是目标房间成员。
   - 对房间 Agent/文件/任务/Tab/成员等工具，目标房间就是 `scopeRoomId`。
5. 调用 `agentService.assertToolAllowed(agent, action)`，保留 Agent 自身工具域权限。

### handler 层领域校验

Router 只做通用 gate，handler/service 仍必须做领域校验：

- 文件：`assertRoomMember(scopeRoomId, actorUserId)`。
- 房间设置/成员/邀请：owner/editor 或 owner-only。
- Agent 默认配置/知识库写入：Agent owner/admin。
- 房间 Agent 模型覆盖：房间 owner/editor。
- 账单：只读当前 `actorUserId` 的账户，不接受任意 userId。
- DM/friends：必须复用好友/DM 参与方规则。

## 风险策略

| risk | Router 默认策略 | handler 仍需校验 |
| --- | --- | --- |
| `read` | 允许直接执行 | 资源可见性 |
| `normal_write` | 允许直接执行，必须审计 | 房间成员/owner 等 |
| `sensitive_write` | 默认要求 actor 是目标房间 owner/editor；若 definition 标记 `requiresConfirmation`，则必须走确认卡 | 具体业务规则 |
| `dangerous` | 默认拒绝直接执行，只允许返回“需要确认卡/暂不开放” | 强确认后的物化流程 |
| `blocked` | 始终拒绝 | 无 |

### 确认卡策略

敏感/危险操作不要让模型“说已确认”就执行。建议统一引入：

```ts
confirmation?: {
  required: boolean | ((ctx, args) => boolean)
  createInteraction: (ctx, args) => InteractionRequest
}
```

第一阶段不必实现完整抽象，但要保留设计边界：

- `agent.create` / `agent.create-request`：只生成确认卡。
- 删除、成员权限变更、邀请 owner/editor、API Key、外部消息发送等必须走确认卡或前端二次确认。
- 确认后的物化流程以确认用户为 actor，重新走 service 权限校验。

## 审计与可观测性

### agent_tool_calls 统一记录

Tool Router 负责：

1. 执行前创建 `agent_tool_calls`：
   - `room_id`: `scopeRoomId || roomId`
   - `agent_id`
   - `run_id`
   - `stream_id`
   - `tool_name/action`
   - `input_summary`
   - `status = running`
2. 执行成功后写：
   - `status = succeeded`
   - `output_summary`
   - `duration_ms`
3. 执行失败后写：
   - `status = failed`
   - `error_code`
   - `error_message`
   - `duration_ms`

如果某些 server-internal 调用不想审计，可显式设置 `audit: false`，但默认应该审计。

### stream activity

Router 可统一发 activity：

- `tool.list/tool.schema` 这类系统工具可静默。
- 其他工具显示“正在执行 文件读取 / 账单查询 / 生成脑图”。
- activity 文案来自 registry `title`，不要散落在各入口。

## 响应和摘要

### 结构化返回

所有 handler 返回统一结构：

```json
{
  "success": true,
  "data": {},
  "message": "可选短说明"
}
```

失败统一：

```json
{
  "success": false,
  "error": { "code": "FORBIDDEN", "message": "..." }
}
```

### Agent 摘要

现有 `inline-agent-tool.service.ts` 和平台托管 auto-read 里各自格式化工具结果。建议迁移为：

- 每个 ToolDefinition 可选 `summarize(result)`。
- 通用 fallback：小 JSON 截断输出，大 JSON 只输出字段摘要和提示。
- 文件/Office/图片/知识库/脑图等有专用摘要。

这样模型二次回复时拿到的是“适合推理的工具摘要”，不是不稳定的接口 JSON。

## 迁移方案

### Phase 0：补设计和测试入口

- 新增本设计文档。
- 明确现有链路不马上重写。
- 增加 `test:smoke` 脚本的设计待办，后续统一跑现有 smoke。

### Phase 1：引入 ToolRouter 壳

新增：

```text
app-actions/types.ts
app-actions/router.ts
app-actions/risk-policy.ts
```

先让 Router 调用现有 `executeAppAction` / `executeLocalAgentTool`，不搬 handler：

- canonical action。
- 统一 context。
- 统一 risk gate 基础逻辑。
- 统一错误格式。
- 保持旧测试通过。

### Phase 2：迁移 registry + executor

把 `executeAppAction` 中已稳定的 action 按领域拆到 handlers：

优先迁移：

1. `tool.*` / `app.call`。
2. `billing.*` / `model.profile.list`。
3. `agent.knowledge.*`。
4. `file.read/info/list` 和 Office read/write。
5. `mindmap.*`。

每迁移一组都补 smoke。

### Phase 3：合并 app-ui 工具

将 `agent-tools.app-ui.ts` 中的：

- conversation
- friends
- dm
- users
- profiles
- chat.list
- agent.my-list / room-list

逐步迁入 registry handlers。保留旧文件为薄兼容层，最终删除重复分发。

### Phase 4：入口全部改用 Router

这些入口统一调用：

- `routes/agent-tools.ts`
- `routes/remote-agent-app-call.ts`
- `inline-agent-tool.service.ts`
- `platform-hosted-agent-runtime.service.ts` auto-read
- Agent CLI 动态模板中的 app-call/raw wrapper

### Phase 5：审计和摘要收口

- ToolRouter 统一 `agent_tool_calls`。
- 删除重复 formatter，改为 registry summarize。
- 房间分析页面只读统一审计数据。

## 回归测试计划

### 必跑静态检查

```bash
pnpm check:size
pnpm typecheck
pnpm build
```

### 建议新增 smoke 聚合脚本

```json
{
  "scripts": {
    "test:smoke": "tsx src/__tests__/app-actions-smoke.ts && tsx src/__tests__/remote-app-call-smoke.ts && tsx src/__tests__/inline-tools-dispatch-smoke.ts && tsx src/__tests__/inline-tool-markup-guard-smoke.ts && tsx src/__tests__/knowledge-runtime-smoke.ts && tsx src/__tests__/office-skills-smoke.ts && tsx src/__tests__/mindmap-skill-smoke.ts"
  }
}
```

实际落地时可放在 `packages/server/package.json`，并按依赖顺序拆成小脚本。

### 重点用例

1. 小蜜 inline 查询“我的 Agent”：只能返回 actor 可见 Agent。
2. 小蜜跨房间读取文件：actor 必须是目标房间成员。
3. Remote Agent 带 runId 调用工具：actor 从 run 恢复。
4. Remote Agent 不带 roomId 调房间工具：返回 `VALIDATION_ERROR`。
5. `agent.knowledge.search/read`：房间知识隔离，公共知识可读，私有 Agent 知识按权限。
6. `agent.create`：不直接创建，只生成确认卡。
7. `file.delete` / `members.add`：非 owner/editor 拒绝。
8. `dangerous/blocked` action：直接调用拒绝。
9. 工具失败：`agent_tool_calls` 记录错误码和耗时。
10. formatter：文件/Office/脑图结果不会把超大 JSON 原样传回模型。

## 风险与缓解

| 风险 | 表现 | 缓解 |
| --- | --- | --- |
| 迁移过大 | 多入口同时改导致回归 | 分 phase，小步迁移，旧 handler 兼容 |
| 权限收紧影响现有 Agent | 原本能做的操作变 403 | 先记录 dry-run/日志，明确哪些 action 需要 actor/scope |
| 审计重复 | app.call 和 target 都记录 | 第一阶段只记录 target；需要调用链时再加 parent id |
| registry 单文件变大 | 工具继续增加难维护 | 按 domain 拆 handlers 和 definitions |
| 参数校验不足 | handler 内部继续散落校验 | 先覆盖高风险写操作和跨房间参数 |
| 模型输出不规范 | inline tool 半截 JSON/夹说明 | 保留现有 markup parser 和 sanitize，Router 只接收提取后的 canonical call |

## 推荐落地顺序

1. 先实现 ToolRouter 壳，不搬 handler，只统一 context/action/error。
2. 把 `app.call/tool.call/tool.list/tool.schema` 迁到 Router，确保发现和代理入口稳定。
3. 把风险 gate 接入，但第一阶段对现有 sensitive action 只做与现有规则等价的校验，不突然扩大拒绝范围。
4. 迁移知识库、账单、Office、脑图这些近期新增能力，因为它们 handler 相对集中、测试已有。
5. 最后拆 `agent-tools.app-ui.ts` 和 `agent.service.ts` 的长期大文件。

## 与既有文档关系

- `DESIGN-ASSISTANT-APP-TOOLS.md`：描述 App Tools 产品目标、覆盖矩阵和小蜜边界。本文件补充“执行架构收口”。
- `DESIGN-REMOTE-AGENT-CONNECTOR.md`：描述远程 Agent HTTP 网关。本文件要求该网关最终进入 ToolRouter。
- `DESIGN-ROOM-ANALYTICS.md`：描述 `agent_tool_calls` 分析。本文件要求 ToolRouter 统一写审计。
- `ARCHITECTURE-AUTH.md`：描述授权原则。本文件细化 Agent Tool 场景下 `actorUserId / agentId / scopeRoomId` 的执行规则。
