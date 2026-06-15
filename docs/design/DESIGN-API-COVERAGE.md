# API 覆盖与助理工具一致性设计

## 目标

所有界面可操作能力应至少有一个稳定 API，并尽量形成四层一致：

1. 前端 UI 操作
2. 前端 `api.ts` 封装或 WebSocket action
3. 后端 REST / WebSocket 实现
4. Agent tool / 默认助理 Skill 可理解、可调用

## 覆盖分级

- P0：界面已有操作但缺 REST API 或稳定封装。
- P1：界面已有操作，REST 已有，但 Agent tool / 助理不会操作。
- P2：后端已有能力，但前端封装或 UI 暂未暴露。

## 当前优先补齐

### P0：任务 REST API

任务 UI 当前主要依赖 WebSocket。补齐 REST，便于前端降级、外部集成和 Agent/系统统一调用：

- `POST /api/rooms/:roomId/tasks`
- `PATCH /api/rooms/:roomId/tasks/:taskId`
- `DELETE /api/rooms/:roomId/tasks/:taskId`
- `POST /api/rooms/:roomId/tasks/:taskId/retry`
- `POST /api/rooms/:roomId/tasks/:taskId/subtasks`
- `PATCH /api/rooms/:roomId/tasks/:taskId/subtasks/:itemId`
- `DELETE /api/rooms/:roomId/tasks/:taskId/subtasks/:itemId`
- `POST /api/rooms/:roomId/tasks/:taskId/subtasks/:itemId/retry`

REST 与 WS 应复用同一服务层语义：校验房间归属、更新后广播 `task.changed`、子任务完成后释放依赖。

### P0：Agent 重启 REST API

房间成员面板有“重启 Agent”操作，当前只走 WS。补齐：

- `POST /api/rooms/:roomId/agents/:agentId/restart`

语义与 WS/Agent tool 的 `agent.restart` 一致。

### P1：Agent tool 文件能力

补齐助理对项目文件的基础管理：

- `file.mkdir`
- `file.delete`

删除属于破坏性操作，默认助理应先确认；工具层只提供能力，交互层负责确认。

### P1：Agent tool 房间/成员能力

补齐低风险和中风险项目管理能力：

- `room.update`
- `room.create-invite`
- `members.add`
- `profiles.update`

高风险能力如 `room.delete` 暂不默认开放，后续应配合确认卡和权限判断。

### P1：Agent/Skill/Script/Scene 工具能力

默认助理已经承担 Agent/场景管理职责，因此工具层需要逐步补齐：

- `agent.detail`
- `agent.update`
- `agent.remove`
- `agent.skill.list/create/update/delete`
- `agent.script.list/create/update/delete`
- `scene.list/create/update`

所有模板编辑必须沿用 actorUserId 同权原则：权限主体是用户，不是 Agent。

## 助理 Skill 更新原则

默认助理 Skill 只写稳定规则和边界，不堆长 API 清单。具体 CLI/API 清单由 `.freechat/API.md` 和 Agent 工作区模板提供。

必须强化：

- 文件交付必须进入项目文件目录。
- 高风险操作必须先确认。
- 权限不足时申请权限，不要伪造成功。
- 操作后必须用 API 返回或文件/任务状态验证。

## 验证

每批补齐后至少执行：

```bash
pnpm --filter @freechat/server typecheck
pnpm --filter @freechat/web typecheck
pnpm check
```
