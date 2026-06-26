# Agent 模板、项目副本与能力维护设计

## 边界修正

Agent 维护对象不是 runtime 实例，而是 Agent 模板或项目内 Agent 副本。

- **Agent 模板**：通讯录/模板库中维护，供场景或项目克隆；全局可见可用，但只有 owner/admin 可编辑。
- **项目内 Agent 副本**：项目创建或添加 Agent 时从模板克隆，项目内独立修改。
- **Runtime Agent 实例**：一次执行过程，不在模板管理中展示运行日志。

因此 Agent 模板和项目 Agent 能力页不展示“最近运行日志”。运行日志属于运行态诊断，另行设计。

## 能力组成

Agent 能力由以下部分组成：

- 基础信息：名称、描述、类型、专长。
- Prompt：`config.systemPrompt` 以及运行时生成的 `AGENT.md/CLAUDE.md`。
- Tool 权限：chat/task/file/page(tab)/interaction/members。
- Skills：结构化 Markdown 能力说明，运行时写入 Agent 私有 `skills/`。
- Scripts：脚本内容与运行策略，运行时写入 Agent 私有 `scripts/`。

## Skill / Script 数据

当前实现：

```sql
agent_skills(id, agent_id, name, description, content, enabled, sort_order, created_at, updated_at)
agent_scripts(id, agent_id, name, description, language, content, enabled, run_policy, sort_order, created_at, updated_at)
```

运行时 `prepareAgentWorkspace` 会把启用的 skill/script 写入：

```text
workspace-data/<roomId>/agents/<agentId>/skills/*.md
workspace-data/<roomId>/agents/<agentId>/scripts/*
```

## 项目内 Agent 管理页面

Agent 管理场景不再创建页面模板；项目房间内的系统 Agent 管理面板用于展示当前项目内 Agent 副本能力：

- 基础信息
- 来源模板和版本
- 是否本地修改
- 工具权限
- system prompt 摘要
- skills
- scripts

这个页面展示的是项目内 Agent 副本，不是运行时实例。

## 对话式修改与同权原则

后续应支持：

1. 用户在项目 Agent 管理页面发起自然语言修改。
2. 大模型读取当前项目内 Agent 副本或全局模板能力。
3. 生成变更提案和 diff。
4. 用户确认后应用。
5. 修改项目副本时标记 `is_modified = true`。

大模型不能直接绕过确认修改模板或安全边界。Agent 助理代创建/修改 Agent 模板时，权限主体必须是对话发起方、任务发起方或交互卡确认人；创建人默认成为模板 owner，后续写操作按该用户的 owner/admin 权限判断。

## 一键更新

项目内 Agent 记录来源模板版本。后续模板升级时：

- 未本地修改：可直接覆盖升级。
- 已本地修改：展示 diff，用户选择覆盖或手动合并。

一键更新不覆盖房间角色、auto_enabled、任务、消息或项目文件。

## 系统默认助理

通用默认 `助理` 是系统内置 Agent：

- 使用 `config.builtInKey = 'default_assistant'` 标识。
- 使用 `config.locked = true` 锁定。
- 在通讯录 Agent 列表置顶展示。
- 可查看、可使用、可克隆进项目，但全局模板不可编辑或删除。
- 后端对基础信息、Skill、Script、权限授予和删除接口做硬保护；前端隐藏编辑/删除入口并显示“默认助理/只读”。



## 平台内置小蜜 Agent

`小蜜` 是客户端/平台级内置助手，不等同于项目房间默认 `助理`：

- 使用 `config.builtInKey = 'xiaomi_assistant'` 标识，`config.locked = true` 锁定。
- 归属系统管理员 `user_freechat_admin`，启动时由 `built-in-agent-bootstrap.service` 幂等创建/更新。
- `deployment = 'server'`，由后端内置 Runner 调用平台 AI 配置，避免首版依赖用户绑定外部 Agent Client；仍会生成 Agent package/Skill，后续可演进到系统级 connector。
- 在通讯录 Agent 列表默认可见、置顶在默认助理之后；普通用户可查看和私聊，但不可编辑、删除、上架/下架或申请接管。
- 入口复用 `direct_agent` 私聊房间：`POST /api/rooms/direct/xiaomi` 会确保当前用户拥有一个与小蜜的私聊房间，并确保小蜜已作为该房间 assistant 加入，避免 `AGENT_NOT_IN_ROOM`。
- 小蜜不为每个用户复制模板；全局内置模板集中维护，升级 prompt、Skill、Tool 权限时启动自动同步。

权限边界：小蜜只能按当前用户/交互确认人的权限调用工具，不能使用系统管理员身份绕过模板、房间、成员或账号权限。删除、权限、外部消息、API Key、账号/平台设置等高风险操作必须先解释影响并要求明确确认。

## Agent 管理能力归并

`Agent管家`、专属管理助理和管理专家不再作为独立 Agent 维护；相关能力全部归并到通用默认 `助理`：

- `助理` 负责 Agent / Skill / Script / 场景管理协助。
- 项目内 Agent 管理面板提供可视化编辑入口。
- 复杂改动仍按任务拆分、权限确认、文件/文档同步和验证流程执行。
- 不再为 Agent 管理场景创建专属 specialist。

### Skill / Script 拆分规则

- 单个 Skill 文档不超过 500 行；接近上限必须按主题拆分。
- Skill 只写原则、流程、边界和触发条件。
- 可执行命令、批处理、检查逻辑应放到 Script。
- 长参考资料、API 清单、模板示例应放到 `res`，再由 Skill 引用。

## 助理角色职责继承规则

- 只要 Agent 在房间中承担助理角色（assistant），就必须继承系统默认房间助理的基础职责：入口响应、上下文总结、任务跟进、专家协调、必要时最终整合/决策。
- 自定义助理不是替换默认助理职责，而是在默认助理职责上叠加业务定制逻辑、领域偏好和专属工作流。
- 因此场景自定义助理替代系统默认“助理”时，只替换具体实例，不改变“助理”这一房间角色的基础职责。
- 专家（specialist）不继承助理入口职责，只响应明确 @ 或任务分派。


### 助理主动接任务规则

- 自定义助理和系统默认助理一样，是房间入口；用户没有明确 @ 专家时，助理必须先承接请求。
- 对明确需求、安排、修改、创建、排查、推进事项，助理不能只解释能力或等待用户再次指派，应说明下一步并推进：自己处理、创建任务/计划/交互卡，或分派给专家。
- 自定义逻辑只影响助理如何处理该场景的任务，不取消“主动接任务、协调专家、跟进状态”的基础职责。

## 角色能力注册表

- 角色相关能力集中定义在 `packages/server/src/services/agent-role-capabilities.ts`。
- 新增角色能力时，应优先在注册表中新增 capability，而不是分别修改系统 prompt、自动助理 prompt 和 Agent 工作区模板。
- 当前注册表输出三类内容：
  - `renderRoleCapabilitiesForPrompt(roleType)`：注入 Agent 系统提示词；
  - `renderRoleCapabilitiesForWorkspace(roleType)`：注入 Agent 私有工作区 `AGENT.md`；
  - `renderRoleCapabilitiesForAutoPrompt(roleType)`：注入自动助理旁听判断 prompt。
- 助理（assistant）能力包括：房间入口、主动接任务、上下文总结与跟进、专家协调、最终整合与决策。
- 专家（specialist）能力包括：只响应明确 @ 或任务分派，不抢助理入口。

## 模板编辑权限

Agent 模板是全局共享资源：所有用户可见可用，但写操作受权限控制。

- 创建人写入 `agents.owner_id`，默认拥有 owner 权限。
- `template_permission_members(target_type='agent')` 中的 editor/owner 也可编辑。
- admin 可编辑和管理权限。
- 非编辑者可通过 `POST /api/agents/:id/permission-requests` 申请 editor 权限。
- owner/admin 可通过权限面板搜索用户并授权 editor，也可审批/拒绝申请。
- Agent 助理代操作时必须使用 actorUserId 判断权限，不能用 Agent 自身绕过模板权限。
