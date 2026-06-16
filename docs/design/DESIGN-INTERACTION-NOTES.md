# DESIGN INTERACTION NOTES

> 从 DESIGN-IMPLEMENTATION-NOTES.md 拆分出的未读消息、交互请求、交互卡状态与 2026-06-10 Agent 协作收口。

- 文件区目录/文件使用 `Folder`、`FileText`。
- 房间 Tab 使用 `MessageCircle`、`Folder`、`PanelsTopLeft`、`CheckSquare`。

### 设置页分 Tab 信息架构

个人设置页和房间设置页都使用顶部横向 Tab，移动端允许横向滚动，避免一个长页面承载所有配置：

- 个人设置：`账号安全 / 数据统计 / 通知 / 系统`。
  - 账号安全包含头像、昵称、用户名展示和密码修改。
  - 数据统计承载全局个人分析。
  - 通知承载浏览器通知开关，后续扩展通知类型偏好。
  - 系统承载退出登录、诊断、缓存清理等入口。
- 房间设置：`基本信息 / 协作者 / 页面与文件 / Agent / 高级`。
  - 基本信息包含房间名称、描述和房间分析。
  - 协作者包含人员、Agent 列表、添加协作者和成员资料编辑。
  - 页面与文件预留页面/文件 Tab 配置入口，当前先回跳房间主界面管理。
  - Agent 包含房间 Agent 列表、添加 Agent 和 Agent 梦境复盘。
  - 高级包含邀请链接和危险操作。

### 24. 危险操作确认交互

项目设置页“永久删除项目”不再依赖浏览器原生 `window.confirm`。为兼容手机浏览器和内嵌 WebView，改为应用内确认弹窗：

- 点击“永久删除项目”先打开底部/居中确认弹窗。
- 弹窗明确展示项目名和不可恢复说明。
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

前端入口：任务看板中失败/阻塞子任务显示“重试”；父任务存在失败项时显示“重试失败项”；Agent 资料弹窗提供“软重启 Agent”。

### 人工界面恢复入口补充

当房间存在 `error` Agent 时，房间顶部显示异常横幅，列出异常 Agent 并提供“一键软恢复”。桌面侧边栏和移动成员抽屉中的异常 Agent 行也直接显示“恢复”按钮，不需要进入资料弹窗。所有入口统一调用 `agent.restart`，仍保留 running-run 防护。

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

聊天输入的 @ 弹窗增加“文件”分组。发送消息时，文件 mention 写入 `mentions`：`{ role: 'file', type: 'file', id, name, path }`。当人类消息触发助理或明确 @ Agent 时，服务端会读取被 @ 的当前房间文件：文本类文件内联最多 20000 字符，非文本文件只注入路径、大小和说明。Agent prompt 会明确标注“用户 @ 了以下项目文件”，要求按路径识别文件，必要时使用 `./freechat file read <path>` 获取完整内容。

Agent CLI 同步新增 `./freechat file info <path>`，用于查看文件大小、类型和修改时间。
