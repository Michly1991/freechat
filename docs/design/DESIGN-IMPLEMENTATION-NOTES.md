# FreeChat 当前实现补充与交互细节

> 从 DESIGN-OVERVIEW 拆分出的实现细节，避免总览文档过大。

## 当前实现补充：房间生命周期、Agent 可见性与邀请加入

> 本节记录当前已落地的实现决策，作为后续开发的基准。

### 1. 本地部署优先

当前 FreeChat 采用本地直接部署方式：

- 后端：`http://localhost:3001`
- 前端：`http://localhost:5173`
- 对外访问：`http://47.101.58.141:5173`
- 不使用 Docker 作为第一版交付方式。

### 2. 房间创建自动初始化默认助理 Agent

用户创建项目/房间时，后端必须自动创建一个默认助理 Agent，并加入该房间。

默认助理属性：

- `name`: `助理`
- `roleType`: `assistant`
- `deployment`: `server`
- `status`: `active`
- `specialties`: `协作 / 总结 / 任务协调 / 决策`
- `config.defaultRoomAssistant`: `true`
- `config.roomId`: 当前房间 ID

创建房间、添加房主、创建默认助理、绑定助理到房间必须在同一个数据库事务里完成，避免出现房间存在但助理不存在的半初始化状态。

### 3. 房间内 Agent 可见性与在线状态

房间主界面必须能看到当前房间内的 Agent，不能只在设置页管理。

成员面板分为两块：

1. 房间成员：人类用户
2. AI Agents：当前房间绑定的 Agent

Agent 状态展示规则：

| status | UI 文案 | 指示点 | 含义 |
| --- | --- | --- | --- |
| `active` | 在线 | 绿色 | 可以被调用/接收任务 |
| `working` | 工作中 | 黄色 | 正在处理任务 |
| `inactive` | 离线 | 灰色 | 当前不可用 |

桌面端在右侧成员面板展示；移动端通过顶部成员按钮打开抽屉查看。

### 4. @提及规则

聊天输入框输入 `@` 时弹出提及面板，面板必须同时展示：

- 房间人类成员
- 房间 AI Agents

规则：

- 不允许 @ 自己，当前登录用户从人类成员候选中排除。
- Agent 候选展示名称、在线状态。
- @弹窗需要支持中文昵称，不能只匹配英文/数字。
- 选中候选后替换输入框中最后一个 `@...` 片段。

### 5. 项目硬删除

项目删除采用硬删除，不做软删除。

删除入口：

1. 首页项目卡片右上角「删除」
2. 房间设置页「危险操作 / 永久删除项目」

权限：

- 只有房主 `owner` 可以删除项目。

删除范围：

- `rooms`
- `room_members`
- `messages`
- `tasks`
- `tabs`
- `room_agents`
- `room_profiles`
- `agent_sessions`
- `room_invites`
- 房间文件目录：`workspace-data/{roomId}`
- 当前房间自动创建的默认助理 Agent

注意：用户手动添加到房间的可复用 Agent 不随项目删除，只解除绑定关系；只有 `config.defaultRoomAssistant = true` 且 `config.roomId` 匹配当前房间的默认助理会被删除。

### 6. 邀请码加入项目设计

系统需要支持用户加入别人创建的房间。

房间设置页生成邀请码：

- 房主/有权限成员生成邀请码。
- 显示邀请码和邀请链接。
- 支持复制邀请码、复制邀请链接。

首页加入项目：

- 首页提供「加入项目」入口。
- 用户输入邀请码。
- 前端调用 `POST /api/rooms/join`。
- 加入成功后跳转到房间。

邀请加入接口：

```http
POST /api/rooms/join
Content-Type: application/json

{
  "invite_code": "xxxxxx"
}
```

成功响应中返回房间信息，前端跳转：

```ts
navigate(`/room/${room.id}`)
```

后续可扩展直接访问邀请链接自动加入：

```text
/join?code=xxxxxx
```

### 7. 成员显示名规则

房间成员面板、移动端成员抽屉、@提及弹窗和房间设置页成员列表，第一展示字段必须是用户昵称：

```ts
nickname || username || displayName || '未命名用户'
```

成员列表不把 `viewer/editor/owner` 等权限角色作为主显示名，避免用户看到一排“观察者/查看者”。权限角色只用于权限判断，不作为成员姓名展示。

### 8. 成员变更实时刷新规则

房间成员列表代表“房间归属成员”，不代表当前在线连接。在线连接状态必须与成员列表分离。

规则：

- 用户通过邀请码加入房间后，`POST /api/rooms/join` 必须通过 WebSocket 向该房间广播 `room.members_update`。
- `room.members_update` 的 payload 必须是完整房间成员列表，字段与 `GET /api/rooms/:id` 中的 `members` 保持一致。
- WebSocket 连接进入/离开房间只代表在线状态，使用 `room.online_update`，不能覆盖房间成员列表。
- 前端收到 `room.members_update` 后直接刷新成员面板和 @提及候选。

### 9. 桌面端成员面板位置

桌面端房间成员面板固定在主内容区左侧；移动端保持底部抽屉模式。

布局：

```text
桌面端：[成员/Agent 面板] [聊天/文件/标签/任务主内容]
移动端：[主内容] + 顶部成员按钮 + 底部成员抽屉
```

### 10. 成员面板默认展示与折叠交互

桌面端房间成员面板默认展开并固定在左侧。右上角不再提供成员开关按钮，避免和房间操作按钮混杂。

折叠规则：

- 成员面板右侧边缘提供悬浮折叠按钮。
- 点击后成员面板向左收起，主内容区占满剩余宽度。
- 收起后在左侧保留一个小型悬浮“成员”按钮。
- 点击悬浮按钮可重新展开成员面板。

移动端屏幕较窄，不默认展开成员面板，使用左下角悬浮“成员”按钮打开底部抽屉。

### 11. 房间头部与成员悬浮按钮细节

房间头部右侧不显示成员数量，也不放成员开关按钮，保持头部简洁。

成员面板收起后的悬浮按钮应放在左侧垂直居中位置，不放在顶部，避免遮挡导航和标签栏。移动端成员悬浮按钮也采用左侧垂直居中位置。

### 12. 成员面板折叠按钮修正

成员面板的“收起/展开按钮”是小箭头按钮，不是完整的“成员”文字按钮。

交互修正：

- 成员面板展开时，收起箭头贴在成员面板右侧边缘的垂直中间。
- 成员面板收起后，只保留一个贴左侧边缘、垂直居中的展开箭头。
- 移动端仍使用底部“👥 成员”悬浮按钮打开抽屉，避免遮挡正文中部内容。

### 13. 聊天消息左右布局规则

聊天消息左右布局按“是否为当前登录用户”判断，而不是按 human/ai 判断。

规则：

- 当前登录用户自己发送的消息：右侧、蓝色气泡、发送者显示“我”。
- 其他人发送的消息：左侧、白色气泡、显示对方昵称。
- Agent 发送的消息：左侧、白色气泡，昵称前显示机器人标识。
- `@` 提及标签在自己的蓝色气泡中使用高对比样式，在他人气泡中使用浅蓝标签样式。

### 14. 用户头像上传配置

用户支持在个人设置页上传头像图片。头像是用户资料的一部分，存储在 `users.avatar` 字段中。

后端接口：

```http
POST /api/user/avatar
Content-Type: multipart/form-data

avatar: File
```

返回：

```json
{
  "user": { "avatar": "/uploads/avatars/usr_xxx.png" },
  "avatar": "/uploads/avatars/usr_xxx.png"
}
```

存储规则：

- 本地存储目录：`packages/server/data/uploads/avatars/`
- 静态访问前缀：`/uploads/avatars/`
- 文件名：`{userId}-{timestamp}.{ext}`
- 支持格式：png / jpg / webp / gif
- 大小限制：2MB

前端展示规则：

- 如果用户有 `avatar`，展示图片头像。
- 如果没有头像或图片加载失败，回退到昵称/用户名首字母默认头像。
- 头像展示范围：个人设置、首页用户入口、房间成员列表、移动端成员抽屉、@提及弹窗、聊天消息气泡。

开发环境 Vite 需要代理 `/uploads` 到后端 `http://localhost:3001`，保证头像 URL 可以从前端域名直接访问。

### 15. 聊天消息头像尺寸

聊天消息气泡旁的头像需要比成员列表头像略大，便于识别发言人。当前聊天区头像尺寸为 `w-11 h-11`，成员列表仍使用较小尺寸以节省空间。

### 16. 聊天头像与单行气泡高度对齐

聊天区头像尺寸调整为 `w-12 h-12`，目标是与单行消息气泡的视觉高度接近一致，增强发言人识别度。

### 17. 聊天历史消息与浏览器本地缓存

聊天历史第一版采用“服务端最近 100 条 + 浏览器本地缓存最近 100 条”的混合策略。

后端规则：

- `MAX_MESSAGES_PER_ROOM = 100`
- `chat.history` 默认返回最近 100 条。
- 服务端清理旧消息时，每个房间至少保留最近 100 条未删除消息。

前端规则：

- 每个房间使用独立 localStorage key：`freechat:room:{roomId}:messages`
- 每个房间本地最多缓存 100 条消息。
- 进入房间时先读取本地缓存并立即渲染。
- WebSocket 连接成功后请求服务端最近 100 条。
- 前端将本地缓存和服务端历史按 `id` 去重、按 `createdAt` 排序、保留最近 100 条。
- 收到 `chat.message` 新消息、`chat.edited` 编辑、`chat.deleted` 删除事件时，同步更新本地缓存。

后续如果消息量继续增长，再增加增量历史接口，例如 `chat.history_since` 或 REST `GET /messages?after=`，避免每次都拉最近 100 条。

### 18. 好友与单聊系统

FreeChat 第一版新增好友与单聊能力，详细设计见：

- `docs/design/DESIGN-FRIENDS-DM.md`

范围：

- 用户搜索
- 好友申请、接受、拒绝
- 好友列表
- 首页从好友发起单聊
- 单聊最近 100 条历史与本地缓存
- 创建项目时从好友中选择初始成员

长期上，项目房间、单聊、普通群聊会逐步抽象为统一 conversation 模型；第一版为了降低改动，项目继续使用 `rooms`，单聊使用独立 `dm_conversations` / `dm_messages`。

### 19. 首页好友/项目 Tab 布局

首页采用双 Tab 布局，默认进入“好友”Tab：

```text
[好友] [项目]
```

好友 Tab：

- 用户搜索与添加好友
- 好友申请处理
- 好友列表
- 从好友发起单聊

项目 Tab：

- 加入项目
- 新建项目
- 项目列表
- 删除项目

移动端同样使用顶部双 Tab，两个 Tab 按钮等宽展示。

### 20. 微信式首页与会话列表

首页改为三栏导航：消息 / 通讯录 / 设置。详细设计见：

- `docs/design/DESIGN-CONVERSATIONS.md`

消息 Tab 混合展示普通单聊和项目房间，并支持最近一条消息、未读数、置顶、免打扰、最近会话排序。

### 21. 手机端微信式首页与移动端适配

手机端首页采用底部固定导航，替代桌面端顶部 Tab：

```text
消息 | 通讯录 | 设置
```

移动端规则：

- 底部导航固定在屏幕底部，高度约 64px，并适配 safe-area。
- 主内容区底部增加留白，避免被底部导航遮挡。
- 桌面端继续使用顶部 Tab。
- 消息列表手机端使用紧凑行样式，隐藏置顶/免打扰文字操作，仅保留更紧凑的入口。
- 新建项目、加入项目弹窗在手机端以底部抽屉方式展示，最大高度 85vh，内容可滚动。
- 聊天页手机端头像使用 `w-10 h-10`，桌面端使用 `w-12 h-12`；气泡手机端最大宽度约 78%。
- 移动端输入框字号不低于 16px，避免 iOS 自动缩放。

### 22. 首页右上角快捷创建入口

首页不在消息列表下方常驻展示“加入项目 / 新建项目”按钮。统一收敛到右上角 `+` 快捷入口：

- 点击 `+` 展开操作菜单。
- 菜单包含：加入项目、新建项目。
- 手机端和桌面端保持一致，减少首页内容区占用。

### 23. 扁平化图标规范

前端统一使用 `lucide-react` 作为免费开源扁平化图标库，避免继续使用 emoji 作为正式 UI 图标。

规范：

- 首页底部导航使用 `MessageCircle`、`Users`、`Settings`。
- 右上角快捷入口使用 `Plus`。
- 项目会话使用 `FolderKanban`。
- 置顶/免打扰等状态使用 `Pin`、`BellOff`。
- Agent 使用 `Bot`，助理/专家角色使用 `ShieldCheck`、`Wrench`。
- 文件区目录/文件使用 `Folder`、`FileText`。
- 房间 Tab 使用 `MessageCircle`、`Folder`、`PanelsTopLeft`、`CheckSquare`。

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
