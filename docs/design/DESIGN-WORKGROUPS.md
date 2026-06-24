# Workgroups / 工作组

## 定位

工作组是 FreeChat 中长期存在的人与 Agent 资源池。它用于把一组人类成员、Agent 成员和多个房间组织在同一个协作边界内。

通用口径：

- 工作组成员之间彼此可见，可被加入同一工作组下的房间。
- 房间仍是消息、文件和交付物的权限边界；只有房间成员能看到该房间内容。
- 工作组可以配置对外入口 Agent；外部用户通过入口进入接待/服务会话，但不会默认成为工作组成员。
- 入口 Agent 可根据用户需求，在同一工作组内选择合适的人或 Agent 创建独立协作会话。
- 设计不绑定具体行业，不使用“案件/律师”等业务术语；行业模板可自行定义业务词。

## 数据模型

### workgroups

- `id`
- `name`
- `description`
- `owner_id`
- `created_at`
- `updated_at`

### workgroup_members

- `workgroup_id`
- `user_id`
- `role`: `owner | admin | member | viewer`
- `joined_at`

### workgroup_agents

- `workgroup_id`
- `agent_id`
- `role`: 工作组内用途标签，默认 `member`
- `enabled`
- `added_at`

注意：`workgroup_agents.role` 仅作为历史兼容字段，新增 Agent 默认写入 `member`。产品界面不再在工作组层区分“助理/专家/运营”等 Agent 角色；工作组只表达 Agent 是否属于该资源池、是否启用、是否可被入口或房间调用。房间运行时可指定一个“协调者”负责默认响应和分流，其余 Agent 作为普通 Agent 成员参与。

### workgroup_entries

用于后续对外分享入口：

- `id`
- `workgroup_id`
- `agent_id`
- `title`
- `description`
- `access_mode`
- `token_hash`
- `enabled`
- `created_by`
- `created_at`
- `updated_at`

### rooms 扩展

- `workgroup_id`
- `workgroup_entry_id`
- `source_room_id`
- `room_kind`: 可使用 `project | direct | intake | service` 等通用类型。

## 默认工作组

每个用户首次创建/使用房间时，系统自动创建一个默认工作组。旧房间或未绑定工作组的房间会归属到创建者的默认工作组。

创建房间时：

- 创建者进入 `workgroup_members`，角色为 `owner`。
- 初始房间成员同步进入工作组，角色为 `member`。
- 初始房间 Agent 同步进入工作组，角色为 `member`。

后续添加房间成员/Agent 时，也会同步加入该房间所属工作组。

## Agent Runtime 上下文

Agent 工作区新增：

```text
.freechat/WORKGROUP.md
```

内容包括：

- 当前工作组 ID、名称、描述；
- 工作组人类成员；
- 工作组 Agent 成员；
- 工作组下当前可见房间。

Agent 需要选择协作者、创建独立协作会话时，应优先读取 `WORKGROUP.md` 或调用工作组工具。

## Agent Tools / CLI

新增工具：

```text
workgroup.info
workgroup.members
workgroup.agents
workgroup.rooms
room.create
```

CLI：

```bash
./freechat workgroup info
./freechat workgroup members
./freechat workgroup agents
./freechat workgroup rooms
./freechat room create "协作会话" --members "成员名" --agents "Agent名" --auto-agent "Agent名"
./freechat room create-json res/new-room.json
```

`room.create` 约束：

- 只能从当前房间所属工作组中选择成员和 Agent。
- 默认只有当前房间协调者 Agent 可主动创建。
- 默认包含当前 actor 用户；可通过 `includeActor=false` 关闭。
- 当前 Agent 会自动加入新房间，除非已经在传入 Agent 列表中。
- 新房间默认 `room_kind = service`，也可显式传入通用 kind。

## 权限与详情接口

工作组管理权限由 `workgroup_members.role` 决定：`owner` 和 `admin` 可管理工作组成员、Agent 资源和分享入口；`member` / `viewer` 只读。

`GET /api/workgroups` 列表项和 `GET /api/workgroups/:id` 详情中的 `workgroup` 都必须返回当前用户视角字段：

- `current_user_role`: 当前用户在该工作组的角色。
- `canManage`: 是否可管理，即 `current_user_role in ('owner', 'admin')`。

前端工作组详情页统一根据详情接口的 `workgroup.canManage` 展示或隐藏成员编辑、Agent 加入/移出、分享入口创建/编辑等管理入口，并显示当前角色/可管理状态，避免列表与详情权限判断不一致。

## 可见性原则

工作组可见性不等于房间内容可见性：

- 工作组内部成员可见工作组资源池。
- 外部参与者只可见自己参与的房间。
- 不在房间内的工作组成员不自动获得该房间消息和文件权限。

## 后续扩展

- 前端工作组管理页；
- 对外入口 Agent 分享链接；
- 外部用户身份和接待会话复用；
- 工作组级限流、审计和权限策略；
- 工作组级 Agent 使用授权与计费策略。

## 真人成员添加

工作组管理者（`owner/admin`）可以在工作组详情的“人员”面板搜索真人用户并加入工作组：

- 搜索使用统一用户搜索接口，但前端只展示 `identityType='human'` 的真人用户。
- 新增真人默认角色为 `member`，后续可由管理者调整为 `admin/member/viewer`。
- 工作组真人成员是后续“Agent 升级给真人处理”的候选范围；Agent 不应升级给非同工作组真人。

## 分享入口可见性

工作组分享入口的“查看/复制链接”能力对同工作组真人成员开放。也就是说，进入同一工作组的真人用户都可以在工作组详情中看到现有分享入口并复制入口链接。

管理能力仍不放开：创建、编辑、启停、删除分享入口仍要求 `owner/admin`。普通工作组成员只能查看和复制，不能修改入口配置，也不能管理工作组 Agent。
