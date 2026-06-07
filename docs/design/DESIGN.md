# AI协同办公云系统 - 系统设计说明书 (System Design)

## 1. 系统概述与目标

本系统是一个面向人机协同（Human-Agent Collaboration）的云原生工作空间。每个"项目室（Project Room）"作为一个独立的协作单元，提供实时通讯、共享文件系统、动态可编辑UI面板以及任务追踪能力。用户与AI Agent通过WebSocket接入，享有平等的读写权限。

### 核心特性

- **实时双向通信**：基于WebSocket的消息总线，支持文本、指令、状态同步。
- **隔离的项目空间**：每个房间拥有唯一的 `RoomID`，服务端物理隔离存储。
- **动态UI引擎**：Tab页签本质为内嵌HTML，支持通过API热更新，所有接入者所见即所得。
- **智能@提及机制**：支持在消息中精准@人或Agent，触发高亮、定向推送及Agent唤醒。
- **人机平权API**：无论是人类还是Agent，均通过统一的WebSocket API进行文件操作、UI渲染和任务流转。

---

## 2. 系统架构设计

### 逻辑架构图

```text
[Client A (User)] [Client B (Agent)] [Client C (User)]
 \ | /
 +---------------------+-----------------------+
 |
 [ WebSocket Gateway ]
 |
 [ Message Router & Auth ]
 |
 +--------------------+--------------------+
 | | |
 [ Chat Service ] [ Workspace Service ] [ Task Service ]
 | | |
 [ File System API ] [ UI Renderer API ] [ State Manager ]
 | | |
 +--------------------+--------------------+
 |
 [ Persistent Storage Layer ]
```

### 服务端目录结构设计

项目在服务器端采用严格的目录级隔离：

```text
/workspace-data/
└── {RoomID}/ # 唯一房号对应的根目录
 ├── chat/ # 对话记录存储
 │ ├── history.jsonl # 历史消息追加写入
 │ └── context.db # 会话上下文/向量检索库
 ├── files/ # 项目文件目录
 │ ├── docs/
 │ └── assets/
 ├── ui/ # 功能界面(Tab)存储
 │ ├── manifest.json # Tab注册表(定义TabID, Title, Icon)
 │ └── tabs/ # 独立HTML文件
 │ ├── tab_dashboard.html
 │ └── tab_code_editor.html
 └── tasks/ # 任务栏数据
 └── board.json # 任务列表及进度状态
```

---

## 3. 核心模块详细设计

### WebSocket 消息协议规范

所有API交互统一封装在WebSocket JSON消息体中。基础消息结构如下：

```json
{
 "msg_id": "uuid-v4",
 "room_id": "rm_8x7y6z",
 "type": "api_request | api_response | broadcast",
 "action": "file.create | ui.update | task.add ...",
 "payload": { ... },
 "timestamp": 1717700000,
 "actor": {
 "id": "user_123 | agent_llm_01",
 "role": "human | ai"
 }
}
```

### 四大核心API模块

1. **聊天室 (Chat)**: 支持 `chat.send` (广播并持久化)、`chat.history` (游标查询) 及 `chat.typing` (打字机动画)。
2. **项目文件 (Files)**: 提供 `file.list`, `file.read`, `file.write`, `file.delete` 等CRUD操作，确保并发安全。
3. **动态UI界面 (Tabs)**: 通过 `ui.list_tabs`, `ui.create_tab`, `ui.update_tab` 管理Tab元数据及HTML内容。前端利用 `<iframe sandbox="allow-scripts">` 承载动态Tab，防止恶意脚本攻击宿主应用。
4. **任务栏 (Tasks)**: 轻量级看板模型，包含 `task.add`, `task.update`, `task.list`, `task.delete`。

### @提及与事件触发 (Mentions & Triggers)

当用户在聊天框输入 `@` 时，前端弹出成员列表。选中后序列化为结构化字符串。

- **Payload扩展**: `chat.send` 增加 `mentions` 数组及 `is_current_user_mentioned` 标识。
- **路由策略**: 对被@的Human触发浏览器通知；对被@的Agent通过内部RPC注入Prompt强制唤醒。同一消息多次@同一Agent仅触发一次唤醒。

---

## 4. 前端交互与@提醒机制设计

### 消息流高亮渲染

将 `@张三` 渲染为带有背景色的标签（Tag）。若当前登录用户是被@的人，标签增加微弱的呼吸灯动画或特殊边框颜色。点击标签可唤起快捷菜单（如回复TA、查看Agent能力说明）。

### 未读与强提醒机制

- **侧边栏红点**: 项目室入口旁出现红色数字角标。
- **消息流分隔线**: 从离线回到聊天室时，插入分割线："—— 你有 3 条新提及 ——"。
- **跨屏联动反馈**: 正在操作功能Tab时被@，右下角弹出悬浮卡片（Toast），提示"[Agent] 提到了你"，并提供"前往查看"按钮。网页Title变为 `(1条新提及)` 以防错过。

### 专属过滤视图

提供 ` @提及` 切换按钮。点击后进入聚焦模式，仅展示包含当前用户 `mentions` 的消息及其前后各1-2条上下文消息。

---

## 5. 官方接入说明文档 (API Reference Draft)

### 快速开始

1. **建立连接**: `wss://api.yourdomain.com/ws?room={RoomID}&token={JWT}`
2. **鉴权**: Token需包含对特定Room的操作权限。
3. **心跳**: 每30秒发送 `{"type":"ping"}`，服务端回复 `pong`。

### 核心接口速查

| Action | 描述 | Payload 关键字段 | 响应 |
| ------ |------ |------ |------ |
| `chat.send` | 发送聊天消息 | `content`, `mentions[]` | `{ success: true, msg_id: "..." }` |
| `file.write` | 写入项目文件 | `path`, `content`, `overwrite` | `{ success: true, version: 2 }` |
| `ui.create_tab` | 新增功能界面 | `tab_id`, `title`, `html_content` | `{ success: true }` (全局广播) |
| `task.add` | 创建新任务 | `title`, `assignee`, `priority` | `{ task_id: "tsk_abc" }` |

### 注意事项与安全限制

1. **沙箱执行**: `ui.create_tab` 注入的 HTML 将在浏览器的严格沙箱（CSP策略限制）中运行，禁止访问父页面的 Cookie 和 LocalStorage。
2. **文件大小限制**: 单次 `file.write` 最大载荷为 5MB，超过请使用分片上传API。
3. **并发冲突**: 多人/多Agent同时 `ui.update_tab` 同一 `tab_id` 时，以最后到达服务端的请求为准（Last Write Wins），建议Agent间通过 `chat.send` 协商UI修改权。
