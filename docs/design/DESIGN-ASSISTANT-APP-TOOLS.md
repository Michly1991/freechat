# DESIGN-ASSISTANT-APP-TOOLS

## 背景

FreeChat 的助手 Agent 不应只会聊天，还应能调用 FreeChat 应用自身的功能 API，覆盖用户在界面上能完成的主要操作。这样助手可以：

- 辅助用户操作项目、任务、文件、Tab、成员和 Agent。
- 创建确认卡/任务计划卡，降低复杂操作的误操作风险。
- 用同一套工具做应用自测和回归验证。

这套能力属于 FreeChat 应用内部的 Assistant App Tools，和外部宿主或 OpenClaw Skill 无关。

## 设计目标

1. **界面操作可工具化**：UI 上的重要操作都能映射到一个助手工具。
2. **同底层服务**：前端 REST API 与助手工具尽量共用 service/DB/WS 广播逻辑，避免两套业务规则。
3. **统一调用协议**：Agent 通过 `./freechat` CLI 或 `raw/tool call` 调用工具。
4. **权限与风险分级**：读、普通写、敏感写、危险操作分级处理。
5. **可自测**：CLI 提供 smoke/selftest 命令，使用隔离命名并尽量清理。
6. **文档轻量**：主文档和模板不堆超长内容；工具清单可拆到 `.freechat` 或 `res`。

## 调用协议

现有入口继续兼容：

```http
POST /api/agent-tools/:roomId
Authorization: Bearer <agent-tool-token>
Content-Type: application/json

{
  "action": "file.read",
  "args": { "path": "docs/a.md" }
}
```

建议逐步支持同义字段 `tool`：

```json
{
  "tool": "file.read",
  "args": { "path": "docs/a.md" }
}
```

返回统一结构：

```json
{
  "success": true,
  "data": {},
  "message": "可选：面向 Agent 的简短结果说明"
}
```

失败：

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "path is required"
  }
}
```

## 风险级别

| 级别 | 含义 | 例子 | 默认策略 |
| --- | --- | --- | --- |
| `read` | 只读查询 | `task.list`, `file.read`, `members.list` | 允许已授权 Agent 直接执行 |
| `normal_write` | 可恢复或低风险写入 | `chat.send`, `task.create`, `file.write`, `tab.create` | 允许执行，保留消息/WS/DB记录 |
| `sensitive_write` | 影响成员、删除、重启、邀请等 | `file.delete`, `tab.delete`, `agent.restart`, `members.add` | 要求房间 owner/editor 或 assistant 角色；建议用 interaction 先确认 |
| `dangerous` | 影响账号/权限/私聊/项目永久删除 | `room.delete`, `dm.send`, `ai.api-key.update` | 默认不开放或必须强确认后再执行 |

## CLI 约定

Agent 工作区根目录提供 `./freechat`：

```bash
./freechat tool list
./freechat tool schema file.read
./freechat tool call file.read '{"path":"docs/a.md"}'
./freechat raw file.read '{"path":"docs/a.md"}'
```

常用命令保持便捷形式：

```bash
./freechat chat recent 20
./freechat chat send "我开始处理"
./freechat file read docs/a.md
./freechat task list
./freechat tab create-local "看板" res/page.html
./freechat members list
./freechat users search 张三
```

## 覆盖矩阵

状态：`done` 已有或本轮补齐；`partial` 部分有；`todo` 尚未接；`blocked` 暂不开放。

| 页面/模块 | UI 操作 | REST API | App Tool | CLI | 风险 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 房间消息 | 查看最近消息 | `GET /rooms/:id/messages` | `chat.list` | `chat recent [limit]` | read | done |
| 房间消息 | 发送消息 | `POST /rooms/:id/messages` | `chat.send` | `chat send` | normal_write | done |
| 房间 | 查看当前房间 | `GET /rooms/:id` | `room.info` | `room info` | read | done |
| 房间 | 修改名称/描述 | `PATCH /rooms/:id` | `room.update` | `room update --name --description` | sensitive_write | done |
| 房间 | 创建邀请链接 | `POST /rooms/:id/invite-link` | `room.create-invite` | `room invite` | sensitive_write | done |
| 房间 | 删除项目 | `DELETE /rooms/:id` | `room.delete` | 暂不提供便捷命令 | dangerous | blocked |
| 任务 | 任务列表 | `GET /rooms/:id/tasks` | `task.list` | `task list` | read | done |
| 任务 | 创建任务 | `POST /rooms/:id/tasks` | `task.create` | `task create` | normal_write | done |
| 任务 | 更新任务 | `PATCH /rooms/:id/tasks/:taskId` | `task.update` | `task update` | normal_write | done |
| 任务 | 删除任务 | `DELETE /rooms/:id/tasks/:taskId` | `task.delete` | `task delete` | sensitive_write | done |
| 任务 | 重试任务 | `POST /rooms/:id/tasks/:taskId/retry` | `task.retry` | `task retry` | normal_write | done |
| 子任务 | 列表/创建/更新/删除/重试 | `/subtasks` | `task.subtask.*` | `task subtask ...` | read/normal/sensitive | done |
| 任务计划 | 创建确认预览 | interactions | `task.plan.create` | `task plan create-json` | normal_write | done |
| 文件 | 文件树 | `GET /rooms/:id/files` | `file.list` | `file list` | read | done |
| 文件 | 读取文件 | `GET /rooms/:id/files/:path` | `file.read` | `file read` | read | done |
| 文件 | 写入/新建 | `PUT /rooms/:id/files/:path` | `file.write` | `file write/write-local` | normal_write | done |
| 文件 | 删除 | `DELETE /rooms/:id/files/:path` | `file.delete` | `file delete` | sensitive_write | done |
| 文件 | 创建目录 | `POST /rooms/:id/files/mkdir` | `file.mkdir` | `file mkdir` | normal_write | done |
| Tab配置 | 显示/隐藏文件 | `/tab-config` | `tab-config.*` | `file show/hide` | normal_write | done |
| Tab | 列表 | `GET /rooms/:id/tabs` | `tab.list` | `tab list` | read | done |
| Tab | 创建/更新/删除/排序 | `/tabs` | `tab.create/update/delete/reorder` | `tab ...` | normal/sensitive | done |
| 成员 | 成员列表 | `GET /rooms/:id/members` | `members.list` | `members list` | read | done |
| 成员 | 添加成员 | `POST /rooms/:id/members` | `members.add` | `members add` | sensitive_write | done |
| 成员档案 | 查看档案 | `GET /rooms/:id/profiles` | `profiles.list` | `profiles list` | read | done |
| 成员档案 | 更新档案 | `PUT /rooms/:id/profiles/:memberId` | `profiles.update` | `profiles update-json` | sensitive_write | done |
| 用户 | 查用户 | `GET /users/:userId` | `users.get` | `users get` | read | done |
| 用户 | 搜索用户 | `GET /users/search` | `users.search` | `users search` | read | done |
| Agent | 可添加 Agent | `GET /agents`/service | `agent.list-available` | `agent list-available` | read | done |
| Agent | 房间 Agent 列表 | `GET /rooms/:id/agents` | `agent.room-list` | `agent room-list` | read | done |
| Agent | 添加/移除/重启 | `/rooms/:id/agents` | `agent.add/remove/restart` | `agent add/remove/restart` | sensitive_write | done |
| Agent | 查看详情 | `GET /agents/:id/detail` | `agent.detail` | `agent detail` | read | done |
| Agent | skill/script 管理 | `/agents/:id/skills/scripts` | `agent.skill.*`, `agent.script.*` | `agent skill/script ...` | sensitive_write | done |
| Agent | 创建请求 | interaction | `agent.create-request` | `agent create-request/create-json` | normal_write | done |
| 场景 | 列表/创建/更新 | `/scenes` | `scene.list/create/update` | `scene ...` | read/normal | done |
| 交互卡 | 创建/列表/响应/消费/取消 | `/interactions` | `interaction.*` | `interaction ...` | normal/sensitive | done |
| 会话 | 列表/已读/偏好 | `/conversations` | `conversation.*` | `conversation ...` | read/normal | done |
| 好友 | 好友列表/申请列表 | `/friends` | `friends.list`, `friends.requests` | `friends ...` | read | done |
| 好友 | 发送/接受/拒绝申请 | `/friends/requests` | `friends.request/accept/reject` | `friends ...` | sensitive_write | done |
| DM | 打开/查看/发消息 | `/dm` | `dm.open/list/send` | `dm ...` | dangerous | done，发送需显式命令 |
| AI 配置 | 查看/测试 | `/ai/config`, `/ai/test` | `ai.config`, `ai.test` | 暂不加便捷命令 | read/sensitive | todo |
| AI 配置 | 修改 key/provider | `/ai/api-key`, `/ai/provider` | 暂不开放 | dangerous | blocked |
| 用户设置 | 修改资料/密码/头像 | `/user/*` | 暂不开放 | dangerous | blocked |

## 自测设计

CLI 提供：

```bash
./freechat selftest smoke
```

Smoke 测试只做低污染检查：

1. `room.info`
2. `chat.list`
3. `members.list`
4. `task.list`
5. `file.write` 写入 `__selftest__/smoke.txt`
6. `file.read` 验证内容
7. `file.delete` 清理
8. `tab.list`
9. `interaction.list pending`

后续可扩展模块级自测：

```bash
./freechat selftest file
./freechat selftest task
./freechat selftest tab
./freechat selftest app-tools
```

所有自测产物必须使用 `__selftest__/` 或 `[SelfTest]` 前缀，执行结束尽量删除。

## 实现计划

1. 保持现有 `/api/agent-tools/:roomId` 兼容，补 `tool` 字段别名。
2. 补工具元数据：`tool.list`、`tool.schema`，供助手查看可用能力。
3. 补齐首批缺口：`chat.list`、`task.delete`、`profiles.list`、`users.*`、`conversation.*`、`friends.*`、`dm.*`、`interaction.cancel`、`agent.room-list`。
4. 扩充 CLI 便捷命令与 `selftest smoke`。
5. 更新 Agent 工作区模板，把“界面所有操作尽量走 FreeChat 工具”写入默认规则。
6. 运行 `pnpm check`，再用现有房间 workspace 或临时请求做 smoke 验证。
