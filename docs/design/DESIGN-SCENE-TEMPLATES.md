# 场景模板与项目初始化设计

## 目标

场景是项目初始化模板。创建项目时选择场景，系统会把场景中的全局 Agent 模板克隆进用户自己的项目房间。

关键原则：

- Agent 模板和场景模板是**全局共享配置**：所有用户可见、可使用。
- 全局共享不等于所有人可改：Agent/场景有 owner/admin 编辑权限。
- 场景负责初始化项目，不参与运行时执行。
- Agent 进入项目时是克隆，不是引用。
- 修改项目内 Agent，不影响全局模板和其他项目。
- 项目房间、消息、任务、文件、页面、Agent 运行会话彼此隔离；不同用户基于同一场景创建的 Agent 管理项目看到不同对话记录。
- 项目内 Agent 记录来源模板和版本，后续支持一键更新。

## 三层对象

1. **Agent 模板**：全局可复用能力定义，包含 prompt、skills、scripts、默认工具权限和版本。所有用户可见可用，但只有 owner/admin 可编辑。
2. **项目内 Agent 副本**：创建项目或加入项目时由模板克隆，之后可在项目内独立修改。
3. **Runtime Agent 实例**：一次对话或任务触发时的临时运行进程，只消费项目内 Agent 副本。

## 内置 Agent 管理场景

当前内置场景：`Agent 管理`。

初始化内容：

- 通用 `助理`：系统内置默认 Agent，在通讯录置顶且不可编辑/删除；由房间默认助理机制提供入口协调、任务拆分、专家分派，以及 Agent / Skill / Script / 场景管理协助。
- `Agent 管理` 场景不再单独创建 `Agent管家`、专属管理助理或管理专家。
- Agent 管理能力通过通用助理的拆分 Skill / Script 提供；长参考资料应放入 `res`，避免单个 Skill 过大。

说明：场景不再初始化项目页面/HTML，也不再初始化专属 Agent；Agent 管理能力通过通用助理 + 项目内 Agent 管理面板提供。

## 数据表

当前实现采用最小落地：

- `rooms.scene_template_id` / `rooms.scene_template_version`
- `agents.owner_id`：Agent 模板 owner；项目 Agent 副本 owner 为项目创建/使用者
- `agents.is_template`
- `agents.template_version`
- `agents.source_template_id`
- `agents.source_template_version`
- `agents.is_modified`
- `agent_skills`
- `agent_scripts`
- `scene_templates.owner_id`：场景 owner，用于编辑权限，不用于可见性过滤
- `scene_templates.built_in_key`：内置场景标识
- `scene_template_agents`
- `scene_template_pages`：历史兼容表，场景应用不再使用

页面仍复用历史 `tabs` 表，产品语义统一叫“页面”。

## 全局共享与编辑权限

Agent 模板和场景模板的读/用权限是全局的：

- 所有登录用户都可以查看全局 Agent 和场景。
- 所有登录用户都可以基于场景创建自己的项目。
- 所有登录用户都可以把全局 Agent 模板克隆到自己的项目。

写权限受 owner/admin 控制：

- 创建 Agent 模板的用户默认成为 `agents.owner_id`。
- 创建场景的用户默认成为 `scene_templates.owner_id`。
- 只有 owner/admin 可以修改 Agent 模板、Skill、Script 或场景配置。
- 后续可扩展 `agent_template_members` / `scene_template_members` 支持 editor/viewer 授权和权限申请。

Agent 助理代执行时遵循同权原则：

- Agent 助理不是权限主体，只是代理执行者。
- Agent 助理创建/修改 Agent 或场景时，权限主体是对话发起方、任务发起方或交互卡确认人。
- 后端 Agent tool token 需要携带 actorUserId，写操作按 actorUserId 的 owner/admin 权限判断。

## 创建项目流程

1. 用户创建项目时选择场景，可为空白项目。
2. 服务端创建 room；如果场景包含 assistant，则跳过默认空白助理。
3. 如果选择场景，场景服务克隆全局 Agent 模板到项目。
4. Agent 管理场景不提供专属 Agent，保留通用默认 `助理` 作为自动助理。
5. 刷新房间 Agent 上下文文件。

## 克隆语义

- Agent 克隆后 `is_template = 0`，记录 `source_template_id/source_template_version`。
- Skill/script 克隆为新记录，绑定项目内 Agent 副本。
- 项目消息、任务、文件、页面和 runtime 记录只属于当前 room，不属于全局场景/Agent 模板。

## 后续扩展

- 场景文件模板：`scene_template_files`。
- 从当前项目发布为新场景版本。
- Agent 一键更新：从来源模板 diff/合并到项目副本。
- 权限申请/授权：owner 同意后授予 editor/admin。

## 房间助理唯一性规则

- 一个项目房间只保留一个 `room_role='assistant'` 的助理。
- 新建项目时，如果选择的场景包含 assistant 类型 Agent 模板，则 `RoomService.createRoom` 跳过系统默认“助理”的创建，由场景助理承担唯一助理角色。
- 应用场景时，如果场景包含 assistant：
  - 删除当前房间自动生成的默认“助理”（`config.defaultRoomAssistant=true`）及其 `room_agents` 关联；
  - 将既有其他 assistant 降级为 `specialist` 并关闭自动响应；
  - 场景内若误配多个 assistant，仅第一个自动助理（或第一个 assistant）保留 `room_role='assistant'`，其余作为专家加入。
- 手动把 Agent 作为助理加入项目时，同样会移除默认“助理”并关闭/降级其他助理，保证房间内助理唯一。

## 场景 Agent 配置语义

- 场景只维护全局 Agent 模板及其默认加入关系，不再维护项目页面/HTML 初始化内容。
- 场景里的 Agent 配置编辑的是全局 Agent 模板，与通讯录 Agent 使用同一套配置模型。
- 区别只是入口：通讯录是大模型对话配置入口；场景是人工预设配置入口。
- 创建项目时，场景中的全局 Agent 模板会克隆为项目内 Agent 副本。
- 已创建项目中的 Agent 副本不会因全局模板后续修改自动变化。
- 项目内 Agent 管理编辑的是当前项目副本，不影响全局 Agent 模板。
- `scene_template_pages` 作为历史兼容表保留，但场景应用不再创建项目页面，前端也不再提供页面配置入口。

## 内置 Agent 管理项目

- `scene_agent_management` / “Agent 管理”是系统内置项目能力入口，不是普通用户场景。
- 用户不能重复创建名为“Agent 管理 / Agent管理”的场景。
- 用户不能删除内置 Agent 管理项目；当前版本没有开放场景删除接口，后续若增加删除接口必须对 `scene_agent_management` 做后端保护。
- 内置 Agent 管理场景全局可见可用；普通用户可基于它创建自己的独立 Agent 管理项目。
- 内置场景名称和描述视为系统保留信息；内置模板修改需要 admin 或系统级权限。

## 权限成员与申请流程

当前版本已落地通用模板权限表：

```sql
template_permission_members(
  target_type,   -- agent | scene
  target_id,
  user_id,
  role,          -- owner | editor
  granted_by,
  created_at,
  updated_at
)

template_permission_requests(
  id,
  target_type,   -- agent | scene
  target_id,
  requester_id,
  requested_role,
  message,
  status,        -- pending | approved | rejected | cancelled
  resolved_by,
  resolved_at,
  created_at,
  updated_at
)
```

权限语义：

- `agents.owner_id` / `scene_templates.owner_id` 是内置 owner，不可被普通 revoke。
- `template_permission_members.role='editor'` 可以编辑对应 Agent/场景模板。
- `role='owner'` 预留给后续共同 owner / 管理员委派。
- owner/admin 可以给其他用户授予 editor、移除 editor、审批/拒绝权限申请。
- 非编辑者可以在只读界面提交编辑权限申请。
- 内置系统场景/模板默认只允许 admin 或系统级权限修改；普通用户可用但不可改。

接口：

- `GET /api/agents/:id/permissions`
- `POST /api/agents/:id/permissions`
- `DELETE /api/agents/:id/permissions/:userId`
- `POST /api/agents/:id/permission-requests`
- `POST /api/agents/:id/permission-requests/:requestId/resolve`
- `GET /api/scenes/:id/permissions`
- `POST /api/scenes/:id/permissions`
- `DELETE /api/scenes/:id/permissions/:userId`
- `POST /api/scenes/:id/permission-requests`
- `POST /api/scenes/:id/permission-requests/:requestId/resolve`
