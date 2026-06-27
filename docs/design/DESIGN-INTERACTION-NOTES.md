# DESIGN INTERACTION NOTES

> 从 DESIGN-IMPLEMENTATION-NOTES.md 拆分出的未读消息、交互请求、交互卡状态与 2026-06-10 Agent 协作收口。

- 文件区目录/文件使用 `Folder`、`FileText`。
- 房间 Tab 使用 `MessageCircle`、`Folder`、`PanelsTopLeft`、`CheckSquare`。

### 工作组 Agent 管理与分享入口

工作组不只是展示资源池，还需要可管理 Agent 和对外分享入口：

- 工作组管理员（owner/admin）可以添加、移出工作组 Agent，并修改 Agent 在工作组内的角色：`member / assistant / expert / operator`。
- 工作组管理员可以调整成员角色或移出成员；不允许移除/降级最后一个 owner。
- 后端补齐接口：`GET /api/workgroups/:id/available-agents`、`PATCH/DELETE /api/workgroups/:id/agents/:agentId`、`PATCH/DELETE /api/workgroups/:id/members/:userId`。
- 工作组分享入口基于 `workgroup_entries`：每个入口绑定一个接待 Agent，生成 `/workgroup-entry/:token` 链接。
- 分享入口第一版要求用户登录后使用；点击“开始对话”后创建 `room_kind='entry'` 的工作组房间，自动加入当前用户和入口绑定 Agent，Agent 可发送入口欢迎语。
- Web 通讯录工作组详情展示人员、Agent、分享入口和房间；入口支持创建、停用/启用、删除和复制链接。

### Agent 设置独立页面与服务端知识库

移动端 Agent 配置不使用弹窗/抽屉，统一进入独立设置页，避免表单、Skills、知识库和发布运行信息挤在联系人列表里：

- Web 新增 `/agents/new` 与 `/agents/:agentId/settings`。
- 首页通讯录和市场中的 Agent 查看/编辑按钮跳转独立页；新增 AI 跳转 `/agents/new`。
- Agent 设置页使用顶部横向 Tab，移动端可横向滚动：`基础 / 能力 / 知识库 / 发布 / 运行`。
  - 基础：名称、描述、专长、system prompt、AGENT.md。
  - 能力：工具权限和 Skills 管理。
  - 知识库：服务端维护 Agent 知识库文件，支持新建、上传、编辑、删除和重建索引。
  - 发布：发布方/收费方、市场状态和后续计费入口。
  - 运行：deployment、接管客户端和在线状态。
- FreeChat Server 是 Agent 知识库主存储：
  - 表：`agent_knowledge_files` 保存文本/Markdown/JSON/CSV 等知识文件正文与元数据；`agent_knowledge_indexes` 保存索引状态、文件数、总大小和最近索引时间。
  - API：`GET /api/agents/:id/knowledge`、`POST /api/agents/:id/knowledge/files`、`POST /api/agents/:id/knowledge/files/upload`、`GET/PATCH/DELETE /api/agents/:id/knowledge/files/:fileId`、`POST /api/agents/:id/knowledge/reindex`。
  - 上传：前端使用 multipart 专用上传接口；服务端读取文件内容并入库为知识文件。当前知识库只接收 Markdown/TXT/JSON/CSV/YAML/XML/HTML 等文本类文件；PDF/Word/Excel 等复杂二进制资料需要先转换/提取为 Markdown 或文本后上传。
  - 权限：可使用 Agent 的用户可以查看知识库摘要/文件；可编辑 Agent 的用户才可增删改、上传和重建索引。
- Agent Client 不再作为知识库主存储，只在运行前通过连接器凭证调用 `GET /api/remote-agents/knowledge` 获取知识目录摘要；运行中通过 `GET /api/remote-agents/knowledge/search` 与 `GET /api/remote-agents/knowledge/read` 按需渐进式检索/读取。
- Agent 自有知识按 root Agent 继承：房间 clone/materialize 的 Agent 使用通讯录 Agent（`COALESCE(source_template_id, id)`）的知识库。
- 通用公共知识接入 `knowledge_entries scope='public'`，搜索时和 Agent 自有知识一起返回；读取公共知识使用 `public:<entryId>` 引用。
- Agent 运行时写入 `.freechat/KNOWLEDGE.md`，只包含知识源摘要和 `./freechat knowledge list/search/read` 使用说明；不主动把知识库正文复制进上下文。

### 设置页分 Tab 信息架构

个人设置页和房间设置页都使用顶部横向 Tab，移动端允许横向滚动，避免一个长页面承载所有配置：

- 首页“设置”Tab 直接展示个人设置二级 Tab：`账号安全 / 数据统计 / 通知 / 系统`，不再只放“个人设置”跳转入口；顶部头像点击也切换到首页设置 Tab。
- 兼容保留 `/settings` 独立路由，内部复用同一套个人设置组件。
- 个人设置：`账号安全 / 数据统计 / 通知 / 系统`。
  - 账号安全包含头像、昵称、用户名展示和密码修改。
  - 数据统计承载全局个人分析。
  - 通知承载浏览器通知开关，后续扩展通知类型偏好。
  - 系统承载退出登录、诊断、缓存清理等入口。
- 房间设置：`基本信息 / 协作者 / Agent / 执行记录 / 诊断 / 高级`。
  - 基本信息包含房间名称、描述和房间分析。
  - 协作者包含人员、Agent 列表、添加协作者和成员资料编辑。
  - 页面与文件不再放在房间设置里，统一回到房间主界面的“文件/页面”面板管理，避免设置页空占位。
  - Agent 包含房间 Agent 列表、添加 Agent 和 Agent 梦境成长。
  - 执行记录展示 Agent 最近运行、耗时、token、工具调用和失败详情；该能力从房间主导航迁移到设置，避免日常聊天主界面过重。
  - 诊断包含房间客户端诊断日志。
  - 高级包含邀请链接和危险操作。

### 24. 危险操作确认交互

项目设置页“删除项目”不再依赖浏览器原生 `window.confirm`。为兼容手机浏览器和内嵌 WebView，改为应用内确认弹窗：

- 点击“删除项目”先打开底部/居中确认弹窗。
- 弹窗明确展示项目名，并说明项目会从列表隐藏但历史账单/流水保留关联。
- 确认按钮显示“删除中...”状态，避免重复提交。
- 取消或点击遮罩可关闭（删除中不可关闭）。

### 会话列表左滑操作

首页消息列表支持移动端左滑操作，类似微信会话列表：

- 左滑会话项露出操作按钮。
- 操作包括：置顶/取消置顶、不显示、删除/隐藏。
- 同时只展开一个会话项。
- 桌面端保留文字操作入口。

会话偏好 `conversation_prefs` 增加 `hidden` 字段。默认消息列表过滤 hidden 会话；隐藏私聊后可通过通讯录重新打开，项目隐藏后可通过项目入口/重新加入等后续入口恢复。

### 通知系统第一版

通知系统第一版覆盖强提醒，避免文件变更等低价值事件刷屏：

- `notifications` 表按用户存储通知，字段包括 `user_id / room_id / message_id / task_id / type / title / body / actor / read_at / created_at`。
- 通知类型第一批：`mention`、`task_assigned`、`task_updated`、`agent_done`、`file_changed`；当前默认触发 `mention`、人类任务分派、任务/子任务进入 `review/done`。
- 项目消息里 @ 人类成员会创建 `mention` 通知；@ Agent 只触发 Agent 调用，不创建人类通知。
- 人类任务/子任务被分派时创建 `task_assigned`；Agent 任务完成或提交审核时通知任务创建者。
- WebSocket 新增 `notification.created`，用于在线用户实时刷新铃铛和触发浏览器 Notification API。
- REST API：`GET /api/notifications` 获取列表与未读数，`POST /api/notifications/read` 支持按 ID 或全部标记已读。
- 首页 Header 增加通知铃铛和通知面板；会话列表对未读 @ 显示“提到我”标记。
- 浏览器通知由用户显式开启，只在页面不在前台时弹出；第一版不做 PWA 推送和复杂通知偏好。

### 通知音效与降噪

通知音效使用前端 Web Audio API 生成，不依赖外部音频文件。音效偏好先保存在浏览器 `localStorage`，后续需要多端同步时再增加后端偏好表。

- 个人设置“通知”页提供：浏览器通知、通知音效总开关、强提醒音、普通消息音和测试音效。
- 强提醒包括 `mention`、`task_assigned`、`agent_done`，默认播放明显提示音；`agent_done` 使用完成音。
- 普通聊天消息使用轻提示音，但默认关闭，避免项目群聊刷屏。
- 房间聊天实时消息忽略自己发送、`agent_receipt`、`agent_stream`，避免 Agent 受理回执和流式活动刷音效。
- 当前房间聊天面板可见且已在底部时，普通消息不响；被 @ 仍可播放强提醒音。
- 前端按 `类型 + 房间` 做 5 秒限频，避免同一房间连续通知高频响铃。
- 浏览器系统通知只对强提醒触发；普通消息只更新未读和可选轻音效。

### Agent 梦境成长

房间设置的 Agent 页合并展示“梦境成长”：统一用“优化 Agent”按钮同时执行梦境避错复盘和成长建议生成。梦境复盘继续根据 Agent 失败和工具错误自动写入避错规则；成长复盘根据用户消息规则提炼项目习惯/协作偏好候选记忆，默认只生成待确认建议。用户点击“采纳”后才写入 `agent_memories`，下一次 Agent 运行时注入“用户习惯与项目记忆”；点击“忽略”则不生效。成长记忆支持删除，删除后不再注入。第一版不自动改 Agent 描述、Skill、工具权限，也不跨项目传播。

### 房间诊断日志

房间诊断日志入口迁移到“房间设置 → 诊断”，不再占用房间聊天顶部工具栏。诊断页复用当前浏览器内存中的客户端日志，展示 Host、路径、房间 ID、Token 是否存在、日志数量，并提供复制和清空能力。房间设置页本身不保持房间 WebSocket 连接，因此诊断页会明确提示 WS 状态只用于排障说明；如需观察实时连接问题，先返回房间触发问题，再进入设置复制日志。

### 房间右侧设置与 Agent 工作提示

房间顶部设置按钮不再跳转离开房间，而是在当前房间内打开右侧设置栏；移动端以全屏/底部抽屉形式覆盖。右侧设置栏承载基本信息、Agent 梦境成长、执行记录、诊断和高级操作，避免用户离开聊天上下文。独立 `/room/:roomId/settings` 路由保留兼容。

当房间内存在 working Agent 时，桌面主导航“聊天”Tab、移动底部“聊天”入口，以及首页消息列表对应项目会话显示黄色呼吸灯；红色未读仍表示新消息，黄色呼吸灯表示 Agent 正在处理。首页会话接口返回 `agentWorkingCount`，并在收到 `agent.status_update` 或消息页短间隔刷新时更新外层呼吸灯。

### Agent 执行可观测化

房间设置新增“执行记录”面板，复用 `agent_runs` 与 `agent_tool_calls` 数据展示最近 Agent 运行状态，避免用户只看到 Agent 名称变黄/变红而不知道发生了什么。房间主导航只保留聊天、文件、页面、任务等高频协作入口。

- 面板默认展示本房间最近 30 次 Agent 运行，支持按房间 Agent 过滤和手动刷新。
- 每条运行展示 Agent、状态（运行中/成功/失败/超时/取消）、触发输入预览、输出/错误预览、开始时间、耗时、token 与工具调用数。
- 点击运行可打开详情弹窗，查看完整输入、输出/错误、工具调用输入摘要、错误码和错误信息。
- 失败或超时运行详情里，如果对应 Agent 仍在房间中，可直接触发软恢复入口，复用现有 `agent.restart` 机制。
- 房间设置里的“分析”仍保留聚合统计、token 和工具失败率；房间主导航“执行”偏实时排障和过程透明。

### 任务 Tab 移动端与协议兼容

任务 Tab 在移动端使用单列纵向看板，避免横向滚动：每个状态区块独立显示任务数量，任务卡片提供大尺寸推进按钮；桌面端仍保持四列 Kanban。创建任务时需要明确反馈：空标题 Toast、创建中按钮状态、连接不可用时提示失败。

WebSocket 任务协议兼容两套命名，避免前后端或 Agent 调用不一致导致“点击无效”：

- 创建任务：`task.add` 与 `task.create` 都可用。
- 更新任务：同时支持 `{ task_id, updates }` 和 `{ id, status/title/... }`。
- 删除任务：同时支持 `task_id`、`taskId`、`id`。

### 任务删除与 Agent 自动接单

任务卡片支持删除操作，删除前必须二次确认，成功/失败通过 Toast 提示。删除通过 `task.delete` WebSocket action 完成，并兼容 `id`、`taskId`、`task_id` 三种任务 ID 字段。

创建任务时，如果没有指定负责人，服务端会自动选择房间内可用 Agent 接单：优先默认助理 Agent，其次第一个非 inactive Agent。自动接单只设置负责人和任务状态（`assigned`），不会立即启动 Claude Code 执行；实际执行仍由用户 @Agent 或后续专门的“交给 Agent 执行”动作触发，避免误执行和资源浪费。

### 父任务/子任务协作模型

FreeChat 的任务模型以助理 Agent 为任务中枢：未指定负责人时，新建父任务只会默认分配给房间助理 Agent，不再随机分配给专家。助理负责判断：自己处理，或拆分子任务分派给专家 Agent。

父任务支持子任务清单。子任务复用主任务状态：`todo / assigned / doing / review / blocked / done / failed / cancelled`，并支持负责人字段。后端任务列表返回：

- `subtasks`：该父任务下的子任务列表。
- `subtaskSummary`：子任务总数、完成数、各状态数量、完成百分比。

父任务卡片必须在收起状态下显示子任务整体状态：完成进度、状态分布、阻塞提示。展开后显示子任务列表，可新增、勾选完成、删除子任务。父任务状态不因子任务自动完成而强制变更，避免误完成；助理或用户可根据子任务汇总决定何时将父任务推进到 review/done。

Agent CLI 支持：

```bash
./freechat task subtask list <taskId>
./freechat task subtask add <taskId> "子任务标题" "说明"
./freechat task subtask update <subtaskId> status doing
./freechat task subtask update <subtaskId> status done
./freechat task subtask delete <subtaskId>
```

### Agent 建任务边界与上下文大小

任务不是所有请求的流水记录，而是复杂协作事项。简单、单 Agent 可完成的请求应直接处理，不创建任务；只有复杂需求、跨 Agent 协作、长期跟踪、需要讨论分发时，才由助理创建父任务并拆分子任务。

Agent 工作区 Markdown 文件需要保持轻量：`AGENT.md`、`CLAUDE.md`、`.freechat/API.md` 等单文件不超过 500 行；超过时拆分到 `res/`，主文件保留索引和按需读取说明。

### 新父任务自动唤醒助理

人类创建未指定负责人的父任务后，系统会分配给房间助理 Agent 并自动唤醒助理。助理根据任务复杂度决定直接做、拆分子任务或分派专家。Agent 自己创建任务不触发自动唤醒，以避免递归和误执行。

### 任务进展摘要

`tasks` 表包含 `progress_note` 字段，用于展示父任务最近进展。助理 Agent 接管任务后应主动聊天汇报，并通过 `task.progress` / `./freechat task progress` 更新任务进展摘要；前端任务卡片直接显示“最近进展”。

### 任务归档展示

任务 Tab 默认只突出活跃任务：`todo / assigned / doing / blocked / review`。`done / failed / cancelled` 进入“已归档”折叠区，用户按需展开查看，避免完成任务堆在主看板中造成“好多任务”的错觉。任务卡片始终显示“最近进展”，没有进展时显示“暂无进展”。

### 任务项目隔离强校验

任务属于项目/房间维度。除创建和列表天然使用当前 `roomId` 外，后端对任务更新、删除、进展更新、子任务增删改查均强制校验目标任务所属 `tasks.room_id` 必须等于当前房间。Agent Tool token 虽绑定房间，但仍执行同样校验，防止误传或恶意传入其他项目的 `taskId/subtaskId` 导致串项目操作。

### 未读消息交互

会话列表显示未读数，超过 99 显示 `99+`，免打扰会话使用灰色弱提示。进入房间后保留短暂未读定位：聊天区会在第一条未读消息前显示“以下是未读消息”分隔线，并滚动到未读附近；随后延迟标记已读。

房间内如果用户不在底部且收到新消息，不强制滚动到底，而是显示“有 N 条新消息”按钮。点击按钮后滚到底并标记已读。移动端底部“聊天”Tab 显示当前房间内新消息红点数字。

### 交互请求消息

FreeChat 支持特殊聊天消息 `interaction_request`，用于需要用户确认、单选或多选的场景。交互请求使用独立表 `interaction_requests` 存储，普通消息表通过 `kind='interaction_request'` 和 `payload.interactionId` 关联。

第一版支持三种类型：

- `confirm`：确认/取消。
- `choice`：单选。
- `multi_choice`：多选。

前端将其渲染为带 `?` 图标的特殊卡片，而不是普通聊天气泡。用户点击按钮或勾选多选后通过 `/api/rooms/:roomId/interactions/:id/respond` 提交，后端广播 `interaction.updated` 更新卡片状态。Agent 可通过 `./freechat interaction confirm/choice/multi_choice` 发起确认或选择请求。

#### 交互请求选项补充输入

`interaction_request` 的选项支持附带文本输入配置：

```json
{
  "value": "other",
  "label": "其他",
  "input": {
    "enabled": true,
    "required": true,
    "placeholder": "请输入其他内容",
    "multiline": true,
    "maxLength": 500
  }
}
```

单选与多选都支持该能力。用户选中带 `input.enabled` 的选项后，卡片内展开输入框；`required` 为真时必须填写才能提交。响应结果保存为：

```json
{
  "value": ["frontend", "other"],
  "labels": ["前端", "其他"],
  "inputs": {
    "frontend": "移动端优先",
    "other": "增加导出功能"
  }
}
```

Agent 简单场景可继续使用 `interaction confirm/choice/multi_choice`，复杂选项配置使用：

```bash
./freechat interaction create-json res/interaction.json
```

#### 交互模式体验优化

交互请求卡片支持更明确的优先级和响应策略：

- `priority`: `normal` / `important` / `danger`，前端分别用蓝色、黄色、红色强调。
- `responsePolicy.allowChange`: 允许用户在未被消费前修改选择。
- `responsePolicy.allowCancel`: 预留取消策略。
- `consumed_by` / `consumed_at`: 标记交互结果已被 Agent 或处理方消费，消费后不再允许修改。

房间聊天区顶部会展示待处理提示条：

```txt
？有 N 个待你处理的请求  [查看]
```

点击后滚动到最近一个待处理交互卡片。交互卡片提交时进入“提交中”状态，防止重复点击；已处理卡片显示结果与补充输入。Agent 工具增加：

```bash
./freechat interaction list pending
./freechat interaction consume <interactionId>
```

用于查询待处理交互并在处理结果后标记已消费。

### 交互卡状态约束

交互请求服务端强制校验：

- `confirm` 没传 options 时自动生成“确认/取消”。
- `choice` / `multi_choice` 必须传 options。
- option 的 `value` 和 `label` 不能为空，`value` 不允许重复。
- `expiresAt` 必须晚于当前时间；已过期的 pending 请求响应时会转为 `expired`。
- 只有 `resolved` 的交互能被 `consume`；消费后不允许修改选择。
- `responsePolicy.allowCancel === false` 时创建者也不能取消。


---

## 2026-06-10 Agent 协作与交互收口

本轮围绕“Agent 可控协作、任务可见、移动端体验、Agent 管理”做了以下系统设计收口：

1. **交互卡历史状态保持**
   - `messageService.getMessages()` 在返回历史消息时会用 `interaction_requests` 的最新状态重新 hydrate `interaction_request` 消息 payload。
   - 刷新页面后，已确认/已取消的交互卡保持 resolved/cancelled，不会重新变成可选择。

2. **任务人工确认后才归档**
   - Agent 通过工具把父任务设为 `done` 时，服务端转换为 `review`。
   - 只有人类在任务面板确认后，任务才进入 `done` 并从进行中视图归档隐藏。

3. **任务 Tab 状态兜底同步**
   - 新增 `GET /api/rooms/:id/tasks`，进入房间时通过 HTTP 拉取真实任务列表。
   - 前端收到 `task.changed update` 时采用 upsert，避免错过 add 事件后任务 Tab 看不见。

4. **父任务状态跟随子任务进展**
   - 任一子任务进入 `doing/review/blocked/done` 后，父任务若仍是 `todo/assigned` 会推进为 `doing`。
   - 前端按子任务摘要兜底展示，避免“已经处理但还在待办、还能开始处理”。

5. **任务依赖与安全唤醒**
   - `task_plan.items[].dependsOn` 落库为 `task_item_dependencies`。
   - 有前置依赖的子任务初始为 `blocked`，并记录 `blocked_reason`，不会提前唤醒 Agent。
   - 当前置子任务全部完成后，服务端自动解除下游子任务阻塞并唤醒对应 Agent。
   - `agent_runs` 增加 stale recovery：超时未结束的 running 记录会被标记 failed，Agent 从 working 恢复，避免僵尸执行状态。

6. **Agent 管理能力**
   - 通讯录 Agent 页面支持编辑已有 Agent：名称、类型、职责、专长、系统提示词、工具权限。
   - 房间助理可发起创建新专家 Agent，但必须通过确认卡，由用户确认后才创建并加入当前房间。
   - CLI：`./freechat agent create-request <name> --description <desc> --specialties <a,b>` / `./freechat agent create-json <path>`。

7. **任务卡与 Agent 头像视觉统一**
   - 任务卡负责人不再用纯 emoji，改为和成员/Agent 一致的小头像：助理为 Sparkles 渐变，专家为 Bot 渐变，人类为头像或首字母。
   - 任务 Tab 图标改为 `ListTodo`。

8. **轻量动效与移动端体验**
   - 增加卡片淡入、hover 上浮、按钮按压、Tab 激活脉冲、进度条流光、待审核柔光等轻量动效。
   - 移动端优化 sticky 顶栏、玻璃感输入栏、bottom sheet、44px 触控目标、安全区适配、任务卡和聊天气泡样式。
   - 动效支持 `prefers-reduced-motion` 降级。

## 2026-06-10 助理主导的短确认处理

确认/取消仍由房间助理 Agent 处理，后端不绕过助理直接执行用户意图。但当房间存在 pending interaction 时，短文本（如“确认”“可以”“同意”“开始”“取消”“不要”）不再被自动旁听的短消息静默规则过滤，也不受普通自动回复冷却限制。系统会唤醒 auto-enabled 助理，并在 prompt 中列出待处理交互卡，提示助理用 CLI 查询和处理。

CLI 合约同步新增：

```bash
./freechat interaction respond <interactionId> <value|value1,value2> [inputKey=inputText...]
./freechat interaction consume <interactionId>
```

助理收到用户短文本确认后，应先执行 `./freechat interaction list pending`，确认卡片，再用 `interaction respond <id> confirm|cancel` 推进；对于 task_plan / Agent 创建请求，respond 会复用前端按钮同一套物化逻辑，创建真实任务/子任务、唤醒专家，并广播 interaction 更新。

## 2026-06-10 任务卡片子任务列表化

任务看板中的父任务卡片默认展示子任务列表，不再只显示一个折叠入口。每个子任务行展示：序号、标题、状态 badge、处理人（人类头像或 Agent 图标 + 名称）、依赖数量、阻塞原因。父任务卡仍保留整体进度条、最近进展和操作按钮；“子任务”按钮改为“新增子任务/收起新增”，只控制新增子任务输入区，避免协作者分工被隐藏。

## 2026-06-10 任务计划确认对话框增强

大模型助理唤起的 `task_plan` 交互卡是用户确认任务分派的主入口。该确认框需要比普通任务卡更完整地展示即将创建的任务结构：

- 父任务：标题、说明、优先级、等待确认状态。
- 子任务列表：序号、标题、说明、处理人、确认后创建状态。
- 协作关系：`dependsOn` 依赖步骤，以“依赖步骤：1、2”展示。
- 交付约束：可选展示 `expectedOutput`（预期产出）与 `acceptanceCriteria`（验收标准）。

对应 `task plan create-json` CLI JSON 字段：

```json
{
  "title": "父任务标题",
  "description": "父任务说明",
  "priority": "medium",
  "items": [
    {
      "title": "子任务标题",
      "description": "子任务说明",
      "assignee": "处理人 Agent 名称或 ID",
      "dependsOn": 0,
      "expectedOutput": "预期产出",
      "acceptanceCriteria": "验收标准"
    }
  ]
}
```

用户确认后，后端物化任务时会将 `expectedOutput` 与 `acceptanceCriteria` 追加到子任务描述中，确保专家 Agent 接收任务时能看到交付要求。

## 2026-06-10 人工重试与 Agent 软重启

新增人工干预恢复能力：

- 子任务重试：`task.subtask.retry` / `./freechat task subtask retry <subtaskId> [--reason <text>]`。重试会把失败、取消、阻塞子任务重新打开；若依赖已满足且处理人是 Agent，会重新唤醒该 Agent。
- 父任务重试失败项：`task.retry` / `./freechat task retry <taskId> [--reason <text>]`。仅重试 `failed`、`cancelled`、`blocked` 子任务，不推倒已完成项。
- 重试审计字段：`retry_count`、`last_retry_at`、`last_retry_by` 同步记录在父任务和子任务上，前端显示子任务重试次数。
- Agent 软重启：`agent.restart` / `./freechat agent restart <agentNameOrId> [--clear-session true]`。软重启将 Agent 恢复为 active/online，并可清理该房间 Agent 会话；如果仍有 running run，拒绝重启，避免双进程并发。
- Agent 强制重启：`agent.restart` 支持 `mode='force'`，CLI 可用 `./freechat agent restart <agentNameOrId> --force true --clear-session true`。强制重启会中断当前 Claude Code runtime，取消 running run，恢复 Agent 在线，并复用软恢复的任务续跑逻辑。

前端入口：任务看板中失败/阻塞子任务显示“重试”；父任务存在失败项时显示“重试失败项”；Agent 资料弹窗提供“软重启 Agent”。

### 人工界面恢复入口补充

当房间存在 `error` Agent 时，房间顶部显示异常横幅，列出异常 Agent 并提供“一键软恢复”。桌面侧边栏和移动成员抽屉中的异常 Agent 行也直接显示“恢复”按钮，不需要进入资料弹窗。working Agent 行和执行记录 running 详情提供“强制重启”入口，二次确认后调用 `agent.restart mode=force`，用于处理卡死或长时间无响应的运行。

### 代码结构整理

Agent 恢复 UI 不再把恢复逻辑和样式全部堆在 `RoomPageImpl` / 成员面板中：恢复动作抽到 `room-agent-actions.ts`，异常 Agent 行拆到 `AgentRow.tsx`，恢复横幅样式集中到 `member-styles.ts`，`RoomPageImpl` 只负责组装入口。

### Agent 恢复按钮合并与错误反馈

异常横幅只保留一个“一键软恢复”按钮，避免同时出现批量恢复和单个恢复造成用户困惑。WebSocket `api_response/error` 现在会进入 toast 和连接提示条，恢复失败（权限不足、Agent 仍在 running 等）不再静默。

### Agent 恢复后任务续跑

`agent.restart` 不再只恢复 Agent 在线状态。恢复成功后，后端会扫描该房间中分配给该 Agent 且状态为 `assigned/doing` 的子任务，最多取最近 5 个重新唤醒 Agent 继续处理，避免“Agent 变绿但任务没有继续跑”的假恢复。

### 超时失败不再永久置 Agent 异常

Agent 调用因 timeout 失败时，run 仍记录为 failed 并保留 lastError，但 Agent 状态恢复为 active/online，避免一次长任务超时导致专家永久不可用。非超时异常仍进入 error，需要人工恢复。

### 聊天/任务分档超时

Agent 运行超时分为普通聊天与任务执行两档：`AGENT_CHAT_TIMEOUT_MS` 默认 120s，`AGENT_TASK_TIMEOUT_MS` 默认 600s，`AGENT_HARD_TIMEOUT_MS` 默认 900s 用于陈旧 running run 恢复。任务分派/重试/恢复续跑使用任务超时，普通聊天/自动助理使用聊天超时。CLI run 超时记录为 `agent_runs.status='timeout'`，Agent 恢复 active/online，不直接把业务任务置失败。

### 专家完成输出后的任务状态回写

任务型 Agent 成功输出中出现“完成/写入/保存/生成”等完成信号时，后端会根据唤醒 prompt 中的 `子任务ID` 自动把对应子任务标记为 `done`，并释放依赖该子任务的后续子任务。这样即使专家忘记调用 `task subtask update ... status done`，任务页也不会停留在 assigned。

同时修正助理创建父任务的默认 assignee：助理通过 CLI 创建父任务且未显式指定 assignee 时，父任务不再默认归属助理，避免任务页误导为“助理自己干”。

### 文件上传与聊天 @ 文件上下文

文件 Tab 支持本地文件上传到当前房间项目文件区，标准接口为 `POST /api/rooms/:roomId/files/upload`（保留旧 `/upload` 兼容路径）。上传文件会加入文件 Tab 配置，前端支持按钮选择和拖拽上传。服务端对上传目录和文件路径执行安全归一化，禁止 `..` 逃逸。

聊天输入区自带附件上传使用独立接口 `POST /api/rooms/:roomId/messages/with-files`，文件保存到 `message-files/<messageId>/` 并写入 `room_files`，消息 `payload.attachments`/`attachments` 返回 `file:<id>` 引用。该接口必须同时保留普通消息能力：`content`、`mentions` 和 `reply_to` 均可随 multipart 提交；有附件的消息如果 @ Agent，服务端仍要把 mentions 传入 side effects，确保明确 @ Agent 不会因走附件上传链路而失效。附件供 Agent 处理时使用 `./freechat file download file:<fileId>`，不得跨房间访问。

聊天输入的 @ 弹窗增加“文件”分组。发送消息时，文件 mention 写入 `mentions`：`{ role: 'file', type: 'file', id, name, path }`。当人类消息触发助理或明确 @ Agent 时，服务端会读取被 @ 的当前房间文件：文本类文件内联最多 20000 字符，非文本文件只注入路径、大小和说明。Agent prompt 会明确标注“用户 @ 了以下项目文件”，要求按路径识别文件，必要时使用 `./freechat file read <path>` 获取完整内容。

Agent CLI 同步新增 `./freechat file info <path>`，用于查看文件大小、类型和修改时间。

### 房间成员角色可见性

房间成员列表必须明确体现当前项目角色：`owner` 显示为“管理员”，`editor` 显示为“协作者”，`viewer` 显示为“只读”。桌面成员栏和移动成员抽屉都应按 管理员 → 协作者 → 只读 排序，成员详情弹窗也要显示“房间角色”。

### 创建人付费与 Agent 指挥权

房间内会产生 token 的 Agent 命令默认只接受项目创建人触发。协作者可以参与讨论和查看共享内容，但不能直接 @Agent 或触发自动助理执行；如果协作者 @Agent，系统提示“只有项目创建人可以指挥 Agent；如产生模型/Agent 费用，由项目创建人承担”。成员栏需显示“付费人 / 可指挥 Agent”。Agent 默认免费；当 Agent owner 设置 per-token 价格后，Agent 服务费按 token 结算。客户端托管 Agent 不计算平台模型费；平台/服务端 Agent 才同时结算 Agent 服务费和模型费。


### 移动端基础交互统一优化

移动端首页与房间页遵循“主路径轻、危险/低频入口后置”的原则：

- 首页 Header 在手机端只保留标题、通知、快捷加号和头像；退出登录仅保留在设置页/桌面端 Header，减少误触和拥挤。
- 首页快捷加号在桌面端仍为右上 dropdown；手机端使用底部 action sheet，操作项高度不低于 48px，点击遮罩或“取消”关闭。
- 首页底部导航和房间底部 Panel Nav 需要考虑 safe-area，按钮最小高度约 56px；激活态使用浅色胶囊背景，而不是仅变色。
- 通讯录二级 Tab 在手机端 sticky 于通讯录区域顶部，使用横向 pill 滚动，并隐藏滚动条。
- 新建群聊弹窗手机端采用 bottom sheet：顶部标题固定、内容区滚动、底部“取消/创建”固定；工作组和场景归为资源归属区，协作者选择用人员/Agent 分段切换。
- 房间 Header 手机端返回按钮只显示圆形箭头图标，房间名下方显示成员与 Agent 数量；桌面端保留完整接待 Agent 信息。
- 聊天输入区移动端保证附件、语音、发送等按钮 44px 触摸目标，placeholder 使用短文案 `输入消息，@成员...`；发送按钮使用纸飞机图标，桌面端可保留“发送”文字辅助识别。
- 工作组详情在手机端保持单列卡片，成员/Agent/房间列表纵向展开，卡片提供明显“进入详情”反馈。

- Agent 列表卡片的高频操作统一使用 icon button：私聊、查看/编辑、删除、上架/取消上架、关注/取消关注；按钮必须带 `title` / `aria-label`，移动端保持 40px 左右触摸区域。



### Agent 编辑弹窗

通讯录 Agent Tab 只负责列表浏览、状态展示和快捷操作，不再在 Agent 卡片下方 inline 展开复杂编辑表单。点击“新增 Agent / 编辑 / 查看”统一打开独立 Agent 设置弹窗：

- 桌面端为大尺寸居中弹窗，移动端为接近全屏的底部弹窗。
- 弹窗内容按区域组织：基础信息、工具权限、Skills、知识库状态。
- 底部保存/取消操作固定，内容区独立滚动，避免长表单把列表撑开。
- 默认助理或无编辑权限 Agent 进入只读查看模式，隐藏保存入口。
- Agent 知识库由 FreeChat Server 统一维护；服务端弹窗/设置页展示服务端知识库状态，Agent Client 运行时通过 `knowledge search/read` 按需渐进式读取，不在本地长期作为主存储。

### 聊天消息头像显示

真人消息头像优先使用房间成员资料中的 `avatar`；如果成员资料暂时匹配不到，可兜底使用消息自身或 payload 中的 `actorAvatar/avatar`。Agent 消息继续走 Agent 专用头像逻辑，不复用真人头像。历史消息或已离开成员缺头像时保持首字母渐变 fallback，不能因头像缺失报错。

## Workgroup share billing rule

- 工作组分享入口采用公开链接模式，不做定向邀请：拿到链接的登录用户都可以进入。
- 每次通过链接进入都会为当前登录用户创建独立入口房间，入口绑定的 Agent 自动作为接待 Agent 加入。
- 入口房间视为私聊式 Agent 会话：用户消息会直接触发接待 Agent，不需要额外 @。
- 计费责任归当前入口房间创建者，也就是点击链接并开始对话的用户；分享者/工作组 owner 不为外部使用者支付模型费或 Agent 服务费。
- Agent 启动前只对已知最低费用做余额预检；余额不足时不启动 Agent，并提示当前用户充值。Agent 默认免费，只有接待 Agent 配置了 per-token 价格才产生 Agent 服务费。
- 分享入口链接改为直达聊天：已登录用户打开链接后直接创建/复用入口房间并跳转 `/room/:id`；未登录用户先登录，登录后继续原链接。
- 分享入口用户是访客，不写入 `workgroup_members`，不会在自己的通讯录里看到被邀请工作组。工作组 owner/admin 在工作组详情里以“访客会话”单独查看入口房间。

## Workgroup share interaction refinement

- 工作组分享入口管理从简单列表升级为卡片式管理：状态、接待 Agent、使用次数、过期时间、费用自付规则、复制/预览/编辑/启停/删除操作都在卡片中展示。
- 创建/编辑入口表单增加 `maxUses` 和 `expiresAt`，并保留启用开关；公开链接说明明确写在表单上方。
- 分享落地页不再展示复杂介绍页；在登录态下直接 join 并进入聊天，只在链接无效/停用/过期/次数用尽时显示轻量错误页。
- 用户通过入口进入后，系统会在新房间内插入系统提示，说明当前会话来自哪个入口、使用哪个 Agent、Agent 免费且模型费由当前使用者承担。
- 删除/停用/移出 Agent 等危险操作需要确认，删除入口不会删除已创建对话，但链接失效。

## Server-side Agent Client takeover request

用户在 FreeChat Server 网页端管理 Agent 时，不应再必须登录 5188 Agent Client 控制台才能接管 Agent。

约定：

- “上架市场”只代表市场可见性，但如果上架的是 `deployment='client'` 且尚未接管的 owner Agent，服务端会自动创建 Agent Client 接管请求。
- 通讯录 Agent 卡片显式展示 `未接管 / 待接管 / 已接管` 状态，并提供“由在线客户端接管”按钮。
- 服务端保存 `agent_client_bind_requests`，状态为 `pending / claimed / failed / cancelled`；pending 请求表示等待 owner 的在线 Agent Client 自动认领。
- Agent Client 已保存 FreeChat Server 账号 token 时，worker 周期性拉取 `/api/agent-client/bind-requests`，对 pending 请求自动创建 pairing code、注册 connector、写入本地配置，然后回写 complete。
- 真正执行仍在 Agent Client 本地进程中；服务端只负责发起接管意图和展示状态。

## Legal intake Agent workgroup routing

客服接待类 Agent 在工作组分享入口中负责初筛和分流，不应依赖硬编码名单：

- 接待 Agent 先通过 `./freechat workgroup agents` 查询当前工作组可用律师/Agent，再根据 `description` 和 `specialties` 匹配案由。
- 刑事、劳务/劳动、合同/法务等路由规则应写入接待 Agent 的 system prompt 和专用 skill。
- 匹配到律师后，接待 Agent 必须使用 `./freechat room handoff --agent <律师名称或ID> --reason <案由+匹配理由>`，不能用普通聊天 @ 律师假装转接。
- `room.handoff` 可转接给当前房间 Agent，也可转接给当前工作组内启用的 Agent。若目标工作组 Agent 还不在分享入口房间，服务端先将其 materialize 到当前房间；若模板 Agent 被 clone，handoff 必须使用 clone 后的 room agent id，而不是原模板 id，避免目标 Agent 加房成功但转接仍报 `Agent not found in room`。

## Entry-room intake prompt precedence

工作组分享入口房间（`room_kind='entry'` 或存在 `workgroup_entry_id`）不能使用普通直聊的“不要分派其他 Agent”提示。入口房间本质是客服接待/分流场景：运行时 prompt 必须允许接待 Agent 使用 `workgroup.*` 工具查询工作组资源，并通过 `room.handoff` 转接给工作组内合适 Agent。

客服接待 Agent 的律师分流规则应强调：未执行 `./freechat workgroup agents` 前不得推荐律师名单；不得编造工作组外律师；信息足够明确时立即 handoff，不继续索要非必要偏好。

## Agent Client final-message and connector stability

Agent Client 运行应避免两类会话污染：

- 远端连接器本地保存 `accessToken` 和 `connectorToken` 时，长驻 worker 访问远端运行接口应优先使用 `connectorToken`。`accessToken` 是短期 JWT，过期后不能让已绑定 Agent 反复报 `Invalid remote Agent connector credential`；原始 connector token 由服务端 token hash 校验并可长期维持绑定。
- `final_to_chat` 模式下，Agent Client 和服务端结算链路不能同时写同一条最终消息。客户端如果已经通过 `./freechat chat send` 发送了完整内容，服务端 `complete` 阶段必须去重；客户端也要避免把“我先查询/正在执行”这类中间进展当最终回复再次自动发送。

对于需要工具的 handoff/分流场景，prompt 应明确：调用会产生用户可见消息或转接的工具后，stdout 只输出简短摘要，不能重复输出已经通过工具发过的完整内容。

## Room billing tab

房间页新增「账单」Tab，用于查看当前房间内的 AI 运行费用：

- 房主视图：房间创建人可以查看当前房间全部 payer 支出、按 Agent/模型/使用者聚合，以及流水明细。
- 分享入口/普通使用者视图：成员只能查看自己作为 payer 在该房间产生的费用；工作组分享入口房间由使用者创建并承担费用，因此使用者可看到自己的入口会话账单。
- 房间账单只统计 payer 侧扣费，收入视角仍保留在首页全局「账单」。
- 未生成 Credit 流水但已有用量记录的运行，在房间账单中作为“未计费用量”提示，用于解释免费/缺少计费规则导致的 0 金额。

API：

- `GET /api/rooms/:id/billing/summary`
- `GET /api/rooms/:id/billing/ledger`

两个接口均要求当前用户是房间成员；创建人返回完整房间视图，其他成员返回当前用户自己的 payer 视图。

## Zero-credit usage records

账单系统区分“扣费”和“用量审计”。当一次 Agent 运行有 token 用量但按规则不产生费用时（例如 Agent Client 本地模型、免费模型规则或缺少可计费模型规则），后端仍应写入一条 `billing_ledger_entries`：

- `entry_type='usage_record'`
- `account_role='payer'`
- `direction='debit'`
- `amount=0`
- token / room / Agent / model / run 关联照常保存
- 不调用钱包扣款

前端展示为“0元用量”。这样房间账单和全局账单都能审计运行次数和 token 消耗，同时 Credit 支出仍为 0。

## 工作组 Agent 与房间协调者命名

工作组只表示人与 Agent 的资源池关系，不再在产品语义上区分工作组 Agent 的“助理 / 专家 / 运营”等角色。`workgroup_agents.role` 仅保留为历史兼容字段，新增工作组 Agent 默认使用 `member`，前端隐藏角色选择和编辑，统一展示为“Agent 成员”。

房间运行时仍允许一个 Agent 作为默认响应入口，但产品文案统一称为“协调者”：

- `room_role='assistant'` / `auto_enabled=1` 是内部兼容字段，对用户展示为“协调者”。
- 其他房间 Agent 展示为“Agent 成员”或“可响应”。
- Handoff 语义从“当前接待”调整为“当前协调者”，表示把默认响应与分流职责转交给另一个 Agent。
- Agent prompt 中不再强调“助理/专家”层级，而强调协调者负责入口、分流、任务计划、必要时转给合适 Agent 或真人。

## 私聊加成员/Agent 的房间升级规则

- 私聊房间（`direct_user` / `direct_agent`）是稳定的一对一入口，不能因为添加第三人或新 Agent 而被原地改造成群聊。
- 在私聊成员面板中添加新的真人成员时，服务端必须新建一个 `room_kind='group'` 的群聊房间，并把原私聊参与者和新增成员加入新房间；原私聊的成员、消息、direct_key 保持不变。
- 在私聊成员面板中添加新的 Agent 时，同样新建群聊房间，复制原私聊已有真人成员和已有房间 Agent，再把新 Agent 加入新房间；原私聊保持不变。
- 新群聊通过 `source_room_id` 记录来源私聊，方便追踪来源，但不会复用私聊的 `direct_key`。
- 前端收到 `createdRoom=true` 时应提示“已新建群聊，原私聊保持不变”，并跳转到新房间。
