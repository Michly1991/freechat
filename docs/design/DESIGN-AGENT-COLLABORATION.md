# Agent 协作、任务与权限实现补充

> 从 DESIGN-AGENT 拆分出的业务自定义 Agent、多 Agent 协作、任务确认、依赖与权限规则。

## 业务自定义 Agent 与多 Agent 规则

业务用户可以创建自己的 Agent，并添加到有编辑权限的项目中。业务 Agent 复用默认助理 Agent 的底层机制：私有工作区、`./freechat` CLI、Agent Tool API、WebSocket 广播、`agent_runs` 记录完全一致；区别在于业务可配置名称、职责、专长、系统提示词、响应模式和工具权限。

### Agent 配置

`agents.config` 使用 JSON 存储运行配置：

```ts
type AgentRuntimeConfig = {
  systemPrompt?: string
  behavior?: {
    replyMode?: 'mention_only' | 'auto_when_relevant'
    silentAllowed?: boolean
  }
  tools?: {
    chat?: boolean
    task?: boolean
    file?: boolean
    tab?: boolean
    interaction?: boolean
    members?: boolean
  }
}
```

默认配置：

- 业务助理：`auto_when_relevant`，默认允许 chat/task/file/tab/interaction/members。
- 业务专家：`mention_only`，默认允许 chat/task/file/interaction/members，默认不允许 tab。

Agent 运行时会把业务配置拼入 system prompt，同时保留系统边界：只能通过 `./freechat` 操作项目，不直接改共享目录；需要用户决策时使用 interaction；长期事项使用 task/progress。

### Agent 房间上下文与协作者可见性

所有 Agent 必须能看到当前房间的人类成员和 Agent 协作者。服务端维护两类上下文：

- `.freechat/ROOM.md`：房间基本信息和当前 Agent 身份。
- `.freechat/MEMBERS.md`：人类成员与 Agent 协作者列表。

`MEMBERS.md` 中的 Agent 信息必须包含：

- Agent 名称和 ID。
- `roleType` / `roomRole`。
- 是否 `autoEnabled`。
- 当前状态。
- 描述和专长。
- 自定义 prompt 摘要。

刷新策略：

1. Agent 启动前，`prepareAgentWorkspace()` 会重新生成当前 Agent 工作区的 `.freechat/ROOM.md` 和 `.freechat/MEMBERS.md`，确保至少本次运行看到最新协作者。
2. 新建项目、添加/移除 Agent、添加人员、加入项目、成员资料变更后，服务端会刷新房间内所有 Agent 工作区的上下文文件。
3. `./freechat members list` 是运行时可信来源，会返回当前房间的人类成员和完整 Agent 列表。

这样助理在分派专家前可以读取 `.freechat/MEMBERS.md` 或调用 `members list`，知道当前房间有哪些专家、专长是什么，以及应该用哪个名称/ID 执行 `--assignee`。

### 工具权限硬控

工具权限不只写进 prompt，后端在 `POST /api/agent-tools/:roomId` 入口强制校验：

- `chat.*` 需要 `tools.chat`
- `task.*` 需要 `tools.task`
- `file.*` / `tab-config.*` 需要 `tools.file`
- `tab.*` 需要 `tools.tab`
- `interaction.*` 需要 `tools.interaction`
- `members.*` / `room.info` 需要 `tools.members`

未授权时返回 `AGENT_TOOL_FORBIDDEN`。

### 房间内 Agent 角色

`room_agents` 扩展房间内配置：

```sql
room_role TEXT DEFAULT 'specialist',  -- assistant / specialist
auto_enabled INTEGER DEFAULT 0,
priority INTEGER DEFAULT 0
```

规则：

1. 一个房间可以有多个 Agent。
2. 一个房间最多一个 `auto_enabled = 1` 的自动 Agent；设置新自动 Agent 时自动关闭同房间其他 Agent 的自动响应。
3. 用户没有明确 @ 专家时，只有 `auto_enabled` 助理作为入口响应；后端不自动把未 @ 消息路由给专家。
4. 助理是调度者：自己能高质量完成就自己做；当前房间有更合适的专家时，应优先通过任务/子任务分派给专家，而不是自己硬做。
5. 专家 Agent 默认只在被人类 @ 或任务/子任务分派时响应，不能因为用户普通发言就突然插话。
6. AI 普通消息不触发其他 Agent，防止 Agent 互相刷屏。
7. Agent 不允许通过普通 @ 自动调度另一个 Agent；多 Agent 协作优先通过任务/子任务和交互卡完成。
8. 助理分派专家时必须创建真实任务/子任务，不能只在聊天里输出“任务表”或 @ 专家。Agent CLI 支持 `--assignee <agentNameOrId>` 指定房间内专家，服务端会解析为 `assignee_id/assignee_name/assignee_type='agent'`。

### 通讯录与项目协作者入口

Agent 被视为通讯录资源，而不是单独的项目设置项。首页通讯录分为：

- 人员：好友、好友搜索、好友申请。
- Agent：我的业务 Agent，支持创建和删除。

新建项目时也使用“选择协作者”模型：

- 可选好友人员作为初始项目成员，默认角色为 editor。
- 可选通讯录 Agent 作为初始项目 Agent。
- 选中的 Agent 可设置为“专家”或“自动助理”。
- 若选中了自定义自动助理，系统仍会创建默认房间助理，但默认助理的 `auto_enabled` 关闭；若没有自定义自动助理，默认房间助理保持自动响应。
- 后端只允许把当前用户拥有的 Agent 作为初始 Agent 加入新项目。

项目设置页统一为“协作者”模型，不再提供独立的“Agent 管理”入口：

- 协作者列表同时展示人员和 Agent。
- “添加协作者”按钮打开统一弹窗。
- 弹窗内分“人员 / Agent”两个 Tab。
- 添加人员时可搜索用户并添加为项目编辑者。
- 添加 Agent 时从通讯录 Agent 中选择，并设置为“专家”或“自动助理”。
- 当前房间 Agent 列表展示“自动助理/助理/专家”标识。

第一版中，自定义 Agent 仅 owner 本人可见/可添加；Agent 创建入口在通讯录 Agent 分类中。

## Agent 处理状态提示

Agent 被服务端触发后，不再向聊天流发送“收到，处理中…”回执消息，避免打扰对话。服务端只广播：

```ts
agent.status_update -> working
```

前端用成员入口、成员列表和对话头像上的呼吸灯提示 Agent 正在处理。Agent 完成后广播 `active/online` 状态并正常发送正式回复；若失败则广播 `error` 状态。

历史上保留的 `agent_receipt` 消息类型仍兼容展示；自动助理构建上下文时仍过滤 `agent_receipt`，避免旧回执污染后续判断。AI 普通消息不触发其他 Agent，因此状态提示也不会造成 Agent 循环。

## Agent 任务创建策略与上下文文件大小

Agent 不应把所有用户请求都转成任务。简单、单 Agent 可以直接完成的事项应直接处理并简短汇报；只有复杂需求、跨 Agent 协作、需要长期跟踪、或需要助理讨论分发时，才创建父任务。

已创建的父任务默认由房间助理 Agent 接管。助理负责判断：自己完成，或拆成子任务分派给专家 Agent。若房间存在明显更合适的专家，助理应优先分派专家，而不是自己硬做；但这个“专家优先”是助理内部调度策略，不是后端自动路由策略。专家 Agent 不应绕过助理随意创建父任务；必要时可向助理汇报建议，由助理统一建父任务/子任务。

助理可以查看当前房间协作者，也可以在用户要求或任务需要时拉入当前用户可用的业务 Agent：

```bash
./freechat members list
./freechat agent list-available
./freechat agent add "分镜专家"
```

`agent.add` 仅允许当前房间助理 Agent 调用；普通专家 Agent 不能自行拉入其他 Agent。第一版只允许添加当前 Agent owner 可用且尚未在房间内的 Agent，不开放添加人类成员。添加后服务端刷新所有 Agent 可见上下文，并通过房间成员更新事件同步前端成员/Agent 列表。

助理不能包办所有专家工作。遇到复合任务、长内容任务、或明显命中房间专家专长的任务，应先查看协作者；如果有匹配专家，禁止直接产出最终成品，必须先用 `./freechat task plan create-json` 发真实任务计划交互卡，或在用户已明确要求立即执行时创建真实任务/子任务并分派专家。禁止只用普通聊天文本、Markdown 表格或数字选项假装任务计划。用户给出大致题材但缺少时长/受众等细节时，助理不应只追问，而应使用合理默认假设创建计划卡，并在计划说明里写清可后续调整。典型场景：用户同时要求“剧本/编剧/文字”和“分镜/镜头/画面”时，助理应拆给剧本编剧与分镜专家，自己只做协调和最终汇总。

任务可见性规则：Agent 不应把父任务直接推进到 `done` 导致任务被归档隐藏。Agent 通过工具把任务状态设为 `done` 时，服务端会转换为 `review`（待审核），必须由人类在任务面板确认后才进入 `done` 并从进行中视图隐藏。只要任一子任务进入 `doing` / `review` / `blocked` / `done`，父任务不能继续表现为待办；服务端会把 `todo/assigned` 父任务推进到 `doing`，前端也会按子任务摘要兜底显示到进行中。

任务依赖规则：`task_plan.items[].dependsOn` 会落库为 `task_item_dependencies`。有前置依赖的子任务初始为 `blocked`，不立即唤醒 assignee Agent；当前置子任务全部 `done/cancelled` 后，服务端解除阻塞并自动唤醒下游 Agent，避免专家提前启动后只进入等待状态。

Agent 创建规则：房间助理可以发起创建新专家 Agent，但必须通过确认卡由用户确认，不能直接创建。工具命令为 `./freechat agent create-request <name> --description <desc> --specialties <a,b>` 或 `./freechat agent create-json <localJsonPath>`；用户确认后，后端以确认用户/房间 owner 为 owner 创建 Agent，并加入当前房间为 specialist。

助理分派专家必须通过真实任务工具完成，例如：

```bash
./freechat task create "编剧专家：创作剧本" "基于故事写出剧本大纲" --assignee "剧本编剧"
./freechat task subtask add <taskId> "分镜专家：编写分镜" "基于剧本生成分镜" --assignee "分镜专家"
```

服务端在 `task.create` / `task.subtask_add` 中解析 `--assignee`，只允许匹配当前房间内 Agent。若被分派 Agent 与当前 Agent 不同，服务端会立即唤醒被分派专家，并通过 `agent.status_update` 驱动前端呼吸指示；不再发送“收到，处理中…”这类聊天回执。AI 聊天文本里的 `@专家` 仍不会触发专家，避免 Agent 循环。

### 任务计划预览与用户确认

复杂事项或多 Agent 分工任务，在创建真实任务前应优先让用户确认任务计划。Agent CLI 提供：

```bash
./freechat task plan create-json res/task-plan.json
```

计划 JSON 示例：

```json
{
  "title": "制作短视频《路灯下的阿橘》",
  "description": "根据故事生成剧本和分镜",
  "priority": "medium",
  "items": [
    {
      "title": "创作短视频剧本",
      "description": "基于故事创作短视频剧本",
      "assignee": "剧本编剧"
    },
    {
      "title": "生成分镜",
      "description": "根据剧本生成分镜脚本",
      "assignee": "分镜专家",
      "dependsOn": 0
    }
  ]
}
```

服务端会创建 `interaction.type = 'task_plan'` 的交互卡片，前端展示父任务、步骤、负责人和依赖关系。用户点击“确认创建”后，服务端才创建真实父任务和子任务，解析各步骤 `assignee`，并唤醒被分派 Agent；点击取消则不创建任务。这个机制用于避免 Agent 自作主张建任务，也避免只在聊天里输出“假任务表”。

Agent 工作区 Markdown 文件必须控制大小：`AGENT.md`、`CLAUDE.md`、`.freechat/API.md` 等单文件不超过 500 行。超过时应拆分到 `res/` 下的专题文件，主 Markdown 只保留索引、摘要和按需读取路径，避免每次启动加载过多上下文。

### 新父任务自动唤醒助理

当人类创建父任务且未指定负责人时，服务端会将任务分配给房间助理 Agent，并立即唤醒助理。助理收到任务上下文后必须判断：简单任务直接完成并汇报；复杂或跨 Agent 任务则拆分子任务并分派专家。Agent 自己通过工具创建任务时不触发此自动唤醒，避免递归触发。

### 任务进展可见性

助理接管父任务后必须主动汇报：先在聊天中说明已接管和处理计划，再用 `./freechat task progress <taskId> "进展说明"` 写入结构化最近进展。任务卡片显示 `progressNote`，用户无需展开任务即可看到最新处理状态。

### 任务房间隔离

Agent 工具只能操作当前房间的任务。服务端在 `task.update`、`task.progress`、`task.subtask_*` 等操作中校验父任务 `room_id`，传入其他房间的任务或子任务 ID 会被拒绝，避免跨项目串任务。

### 2026-06-10 依赖任务与 Agent 管理补充

- 交互卡历史消息会从 `interaction_requests` 重新 hydrate 最新状态，刷新后不允许重复选择已处理卡片。
- Agent 将父任务置为 `done` 会转换为 `review`，必须人工确认后才归档。
- `task_plan.items[].dependsOn` 已落库为 `task_item_dependencies`；有依赖的子任务初始 `blocked`，上游完成后自动解除阻塞并唤醒下游 Agent。
- stale `agent_runs.running` 会按超时窗口回收，避免前端一直显示 Agent working。
- 房间助理可通过确认卡请求创建新专家 Agent；用户确认后才创建并加入当前房间。
- 通讯录 Agent 页面支持编辑已有 Agent 的名称、类型、职责、专长、系统提示词和工具权限。
