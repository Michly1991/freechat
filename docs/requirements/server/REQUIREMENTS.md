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
- 小蜜/平台托管运行时的 inline `agent.create` 只能兼容为创建确认卡，不能绕过确认直接创建；确认后的物化流程必须按确认用户/房间 owner 归属创建并加入房间。
- Agent 读取其他 Agent detail、skill、script、knowledge 前必须验证可访问性。
- Agent Client 不是知识库主存储；知识库由 FreeChat Server 统一维护，Agent Client 运行前同步本地 `.freechat/knowledge/`。
- Agent 知识库上传必须走服务端 multipart 接口并由服务端校验权限、路径和文件类型；当前只允许 Markdown/TXT/JSON/CSV/YAML/XML/HTML 等文本类知识文件，PDF/Word/Excel 需先转换为 Markdown/文本。
- 运行时知识库必须按需渐进式加载：服务端提供 `knowledge list/search/read`，Agent Client 只下发目录摘要和工具说明；Agent 需要背景资料时先 search，再读取少量命中条目。
- Agent 自有知识按 root Agent 继承，房间克隆 Agent 必须读取通讯录 Agent 的知识库；通用公共知识可作为补充搜索源，但不得绕过权限读取私有 Agent 知识。
- Agent Client 长驻 worker 连接远端运行接口时，必须优先使用本地保存的原始 connector token，而不是短期 access JWT，避免已绑定 Agent 因 JWT 过期反复无法 heartbeat/poll/complete。
- `final_to_chat` 模式不能让客户端和服务端重复写最终消息；服务端完成运行时要对同 run 期间已经由 Agent 发送的相同内容做去重，客户端也不能把工具执行前的中间进展当最终回复自动发送。
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

## 文件与消息附件

- `POST /api/rooms/:roomId/messages/with-files` 必须至少校验房间成员身份，文件落到当前房间 `message-files/<messageId>/`，并写入 `room_files`，通过消息 `payload.attachments` 返回 `file:<id>` 引用。
- 附件消息必须保留普通消息语义：服务端要解析 multipart 中的 `content`、`mentions`、`reply_to`，创建消息后 side effects 使用相同 mentions，确保 @ Agent、通知、自动助理逻辑一致。
- 附件文件和项目文件下载/读取都必须限定当前房间，禁止跨房间引用或路径逃逸。

## 小蜜代替界面操作 / App Action

- 服务端必须提供界面功能级 App Action Registry，覆盖用户在界面上常用的 Agent 管理、Agent 知识库、账单查询、模型配置查询、房间/成员/文件/任务等功能。
- 小蜜和 Agent CLI 调用界面功能必须通过统一 `app.call`/`tool.call` 或明确 action，不能直接绕过服务端权限访问内部 REST API。
- `tool.list`/`tool.schema` 应返回 action 元数据、风险等级和参数说明，帮助 Agent 自主选择正确工具。
- 所有 App Action 必须以当前 actorUserId 为权限主体；小蜜不能因为是内置 Agent 获得额外权限。
- 账单类 App Action 默认只开放查询当前用户账户、汇总和流水；调账、充值扣款、价格和密钥类管理 API 不提供给小蜜默认调用。
- 小蜜与当前用户同权：小蜜代操作必须以 actorUserId 为唯一权限主体；用户在界面上有权限做的，小蜜可以代做；用户无权做的，小蜜也无权做。小蜜不能使用系统 owner、内置 Agent owner 或房间创建人作为越权主体。
- 小蜜不应被小蜜私聊房间错误降权：用户级能力（通讯录 Agent、Agent 知识库、账单、模型配置等）按 actorUserId 判断；项目/房间级能力可传目标 roomId，服务端必须校验 actorUserId 是目标房间成员并具备相应角色。
- 私聊房间不可原地扩容：`direct_user` / `direct_agent` 添加真人成员或 Agent 时，服务端必须新建 group 房间，保留原私聊不变；新房间记录 `source_room_id`。
