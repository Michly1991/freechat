# FreeChat 服务端要求

## 服务端是安全边界

服务端必须负责并兜底：

- 核心业务规则。
- 数据校验。
- 鉴权与授权。
- 权限兜底。
- 审计归属。
- 计费与免费额度结算。
- 资源归属校验。

前端隐藏按钮、路由判断、禁用态只属于 UX，不能作为安全边界。

## 权限模型要求

涉及以下资源时，必须先设计权限模型，并在服务端强校验：

- 用户角色。
- 房间与房间成员。
- Agent 与房间 Agent。
- Agent 知识库。
- 文件、页面、Tab 配置。
- 任务、子任务、交互请求。
- 通知、会话偏好、DM。
- Voice 任务、消息、房间上下文。
- 计费、钱包、免费额度、价格策略。

## 房间权限基线

- 读取房间内资源通常至少要求 `assertRoomMember`。
- 修改房间元数据、成员、邀请、Tab 配置、Agent Growth、Agent 加入/移除等，至少要求 editor 或更高权限。
- owner-only 操作包括：
  - 转让/授予 owner。
  - 降级/移除 owner。
  - 移除其他成员。
  - 保护最后一个 owner，不能让房间无 owner。
- 邀请链接默认最小权限：`viewer`。
- 邀请加入必须校验 revoked、expired、max uses、room existence/deletion。

## Agent Tool 与 Agent 行为

- Agent Tool 不能绕过人类 actor 权限。
- `members.add`、`agent.add`、`room.create-invite` 等工具动作必须按 actor 在房间中的权限校验。
- Agent 读取其他 Agent detail、skill、script、knowledge 前必须验证可访问性。
- Agent Client 不是知识库主存储；知识库由 FreeChat Server 统一维护，Agent Client 运行前同步本地 `.freechat/knowledge/`。
- 工作组分享入口房间允许当前接待 Agent 使用 `room.handoff` 转接给同工作组内启用的 Agent；当目标 Agent 尚未在入口房间时，服务端先加入/clone 到当前房间，再用实际 room agent id 执行 handoff。

## 计费与免费额度

- 计费、免费次数、promotion/free quota 必须服务端计算。
- 客户端不能决定是否免费、是否扣费。
- 小蜜等内置 Agent 的免费次数由服务端 `agent_billing_rules.model_free_runs_per_day` 和 pricing/billing 逻辑按 payer/day 结算。
- 用户自带模型 profile 由服务端按 `model_profiles.owner_id === payerUserId` 判定；平台托管 Agent 使用付款人自己的模型时，不收平台模型费，只记录可信用量。
- Agent 默认模型应在通讯录 Agent 管理页配置；该默认模型对所有房间、私聊、工作组入口统一生效。房间内只保存 override。有效模型解析顺序必须是：房间覆盖 -> Agent 默认模型 -> 平台默认模型。
- 模型后续可售卖：共享/市场模型有定价时，其他用户通过 Agent 默认模型或房间覆盖使用该模型，应按模型提供者价格结算；私有模型不能被他人隐式白嫖，必须先共享/上架并有明确授权/购买/关注。
- client-hosted Agent runtime 不应被服务端当作平台模型费用扣费，除非明确是 platform-hosted runtime。

## 服务端架构拆分

- 普通代码文件目标控制在 1000 行以内。
- 优先通过设计模式解耦职责，而不是机械拆文件。
- 推荐模式：
  - 薄路由。
  - 领域服务。
  - repository。
  - policy / strategy。
  - handler / action router。
  - pure calculation module。
  - schema installer 按领域拆分。
- 权限密集路径要配 smoke/regression test。
