# Direct Rooms / 统一私聊房间设计

## 背景

用户确认：AI 私聊和用户单聊本质都应是“单开一个房间”。它们需要出现在消息列表里，体验参考房间模式；后续可继续添加 Agent 或其他人，把私聊自然升级成多人协作房间。

## 设计原则

- 私聊不是独立 DM 数据模型的新分支，而是 `rooms` 的一种轻量形态；用户可见层区分“真人 / AI / 群聊”。
- AI 私聊：创建 `room_kind = direct_agent` 的房间，成员为当前用户，目标 Agent 作为该房间唯一助理加入 `room_agents`；用户消息无须 `@Agent`，自动由该 Agent 消化。
- 用户单聊：创建 `room_kind = direct_user` 的房间，双方都是 `room_members`。
- 后续添加其他人或 Agent 仍走已有房间成员/Agent 管理能力，不需要迁移数据。
- 消息、未读、语音、Agent 流式响应、任务/文件/Tab 能力都复用房间能力；前端默认仍进入 `/room/:id`。
- 原“项目”用户文案改为“群聊”，底层旧 `project` kind 兼容为 `group`。
- Agent 模板本身不再在用户语义上区分“专家/助理”；助理是房间维度的身份，每个房间最多一个房间助理。普通群聊选择的第一个 Agent 默认成为房间助理。

## 数据字段

`rooms` 增加：

- `room_kind`：`group | direct_user | direct_agent`；旧数据里的 `project` 兼容视为 `group`。
- `direct_key`：去重键。
  - 用户单聊：`user:<sortedUserA>:<sortedUserB>`
  - AI 私聊：`agent:<ownerUserId>:<agentId>`
- `direct_target_type`：`user | agent`。
- `direct_target_id`：发起私聊的目标用户或 Agent。

## API

### 打开用户单聊房间

`POST /api/rooms/direct/user`

```json
{ "userId": "user_xxx" }
```

约束：

- 不能和自己单聊。
- 只能和好友发起。
- 若 `direct_key` 已存在且当前用户仍是成员，则返回已有房间。

### 打开 AI 私聊房间

`POST /api/rooms/direct/agent`

```json
{ "agentId": "agent_xxx" }
```

约束：

- 当前用户必须能使用该 Agent（自己创建、已关注或有权限）。
- 若 `direct_key` 已存在且当前用户仍是成员，则返回已有房间。
- 新房间不创建默认系统助理；目标 Agent 作为 `room_role = assistant + auto_enabled` 加入。
- AI 私聊使用轻量一对一 prompt，避免简单测试对话也套用群聊助理判断/任务分派大模板；上下文窗口更短，且无附件提及时不做文件提及解析。

## 前端入口

- 通讯录 → 人员 → 发消息：调用用户单聊房间 API，跳转 `/room/:id`。
- 通讯录 → Agent → 私聊：调用 AI 私聊房间 API，跳转 `/room/:id`。
- 消息列表继续混合展示所有房间；`direct_user` / `direct_agent` / `group` 分别显示“真人 / AI / 群聊”。

## 响应速度优化

- Agent 触发后先即时发送 `agent_receipt`，避免用户在 Runtime 冷启动期间无反馈。
- `direct_agent` 只带最近少量对话，提示词明确要求直接回复，不做“是否介入/是否分派”的群聊判断。
- Agent Client 侧使用 Claude Code `stream-json` 解析并保存 `session_id`，同一 Agent/房间 5 分钟内后续请求优先 `--resume`，减少重复上下文开销；超过 5 分钟无消息则删除热会话，下次重新开始。TTL 可用 `FREECHAT_AGENT_CLIENT_SESSION_TTL_MS` 调整。

## 兼容

旧 `dm_conversations` / `dm_messages` 暂保留，避免破坏历史入口和兼容工具。新的通讯录“发消息”入口改走 Direct Room；后续可评估迁移旧 DM 历史到房间消息。

## 房间当前接待 / Handoff 模式

Agent 模板本身不区分专家/助理；“当前接待”是房间运行时身份。房间支持 handoff：

- `rooms.assistant_mode`：默认 `fixed`，发生转接后为 `handoff`。
- `rooms.current_assistant_agent_id`：当前接待 Agent。
- `rooms.assistant_handoff_at/by/reason`：最近一次转接审计信息。
- `agentService.getAutoAgent(roomId)` 优先读取 `current_assistant_agent_id`，否则回退到 `room_agents.auto_enabled = 1`。
- 转接时会同步更新 `room_agents`：目标 Agent 设为 `room_role = assistant + auto_enabled = 1`，其他 Agent 设为普通可接待。

API：

```http
POST /api/rooms/:id/assistant/handoff
{ "agentId": "agent_xxx", "reason": "刑事案件由张小猫接待" }
```

Agent 工具 / CLI：

```bash
./freechat room handoff --agent 张小猫 --reason "刑事案件更适合张小猫接待"
```

语义边界：

- 客服/接待场景需要另一个 Agent 继续对话时，使用 handoff。
- 项目协作产出、明确子任务、异步执行事项，使用 task/subtask `--assignee`。
- 普通聊天中 AI 文本 `@另一个Agent` 不会触发该 Agent；服务端会拦截带转交意图的假 @ 并提示改用 handoff 或任务分派。

前端展示：

- 房间头部显示“接待：Agent 名称”。
- 成员面板 Agent 行显示“当前接待 / 可接待”。
- 非当前接待 Agent 可手动点击“接待”切换。

## Handoff 服务端/客户端解耦边界

实现上分为两层服务，避免 Web API、Agent 工具和 Agent Client 相互耦合：

### RoomAssistantService

负责房间当前接待状态和 handoff 编排：

- 校验目标 Agent 是否在房间内且可用。
- 事务切换 `rooms.current_assistant_agent_id` 和 `room_agents.auto_enabled/room_role`。
- 写入 `room_assistant_handoffs` 审计记录。
- 广播 `room.assistant_handoff`、`room.updated`、`room.members_update`。
- 根据 `wake` 参数调用 `AgentInvocationService` 唤醒目标 Agent。

Web API `POST /api/rooms/:id/assistant/handoff` 和 Agent 工具 `room.handoff` 都只调用该服务，不各自实现状态切换。

### AgentInvocationService

负责统一 Agent 调用，不关心调用来源是人类 @、自动助理、任务分派还是 handoff：

- 更新 Agent working/active/error 状态。
- 调用 `agentService.spawnClaudeCode`，由 Agent deployment 决定走服务端 runtime 还是远程 Agent Client。
- 发布 Agent 产物、处理任务完成检测、广播最终聊天消息。
- 支持 `runSource` 和 `responseMode`：
  - `runSource = handoff`：表示当前接待转交唤醒。
  - `responseMode = final_to_chat`：最终 stdout/结果应作为聊天回复。
  - `responseMode = tool_only`：只通过工具产生用户可见输出，避免任务执行摘要重复发到聊天。
  - `responseMode = silent`：内部执行，不主动发聊天。

### Agent Client

Agent Client 不保存或判断“谁是当前接待”，只作为执行器：

1. 从服务端接收 remote event。
2. 根据 payload 中的 `input/runSource/responseMode/metadata` 运行本地 Claude Code。
3. `responseMode = final_to_chat` 时自动把最终输出回传为聊天消息；`tool_only` 时不自动发送 stdout。
4. 本地 `./freechat room handoff` 只是薄 wrapper，调用服务端 `room.handoff` 工具，不直接修改房间状态。

## Handoff Request / 默认自动接受

当前接待 Agent 不直接“拥有并修改”管理权，而是向服务端发起管理权转交请求；服务端作为唯一裁决方默认自动接受：

1. 当前接待 Agent 调用 `room.handoff` / `./freechat room handoff --agent <名称> --reason <原因>`。
2. 服务端创建 `room_assistant_handoff_requests`，广播 `room.assistant_handoff_requested`。
3. 默认策略 `policy = auto`，服务端立即接受请求，广播 `room.assistant_handoff_accepted`。
4. 服务端调用 `RoomAssistantService.handoff` 切换当前接待，广播 `room.assistant_handoff`、`room.updated`、`room.members_update`。
5. 服务端通过 `AgentInvocationService` 下发 `runSource = handoff`、`responseMode = final_to_chat` 的 Agent 事件给目标 Agent Client。

权限约束：

- `requestedByType = agent` 时，只有当前接待 Agent 可以发起 handoff request；普通 Agent 不能擅自交换管理权。
- Web 手动切换仍可由房间成员发起，但也走 request + auto accept 流程，方便后续统一改成人工确认或策略裁决。

新增审计表：

- `room_assistant_handoff_requests`：记录请求阶段，包含 `pending/accepted/rejected/expired` 状态、来源、原因、决策时间。
- `room_assistant_handoffs`：记录最终已执行的接待权切换。
