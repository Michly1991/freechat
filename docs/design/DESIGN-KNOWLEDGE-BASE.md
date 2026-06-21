# FreeChat 分层知识库设计

## 目标

为 FreeChat 增加可管理、可检索、可注入 Agent Runtime 的知识体系，解决“公共资料复用”和“Agent 专属经验/案例沉淀”之间的冲突。

## 三层模型

知识库不做单一公共池，而是分为三层：

1. `public` 公共知识库
   - 通用法规、制度、模板、FAQ、行业知识。
   - 默认所有登录用户/Agent 可检索。
   - 仅 admin 可维护。
2. `agent` Agent 专属知识库
   - 某个 Agent 自己的经验、案例、方法论、答复风格。
   - 例如律师 Agent 的历史办案经验和常用文书策略。
   - 仅 Agent owner/admin 可维护；运行时只注入给该 Agent。
3. `room` 房间知识库
   - 当前房间/客户/项目的事实、资料摘要、已确认结论。
   - 仅当前房间成员可读；房间 editor/owner/admin 可维护。
   - 运行时只注入当前房间内 Agent。

## 数据模型

当前 MVP 表：`knowledge_entries`

关键字段：

- `scope`: `public | agent | room`
- `owner_user_id`
- `agent_id`
- `room_id`
- `title`
- `content`
- `tags`
- `source_type`
- `source_file_id`
- `visibility`
- `status`
- `created_by / updated_by`

## 检索与注入

Agent 执行前，服务端按当前 `roomId + agentId` 组装可参考知识：

1. 公共知识库
2. 当前 Agent 专属知识库
3. 当前房间知识库

MVP 使用关键词匹配排序，最多注入 8 条，每条截断到 1200 字，作为 `【可参考知识库】` 放在用户/系统请求前。

后续可以替换为向量检索，但权限边界不变：不同 scope 不串，房间资料不跨房间泄露，Agent 专属经验不默认给其他 Agent。

## 管理入口

- 通讯录 → 知识：公共知识库管理（非 admin 写入会被后端拒绝）。
- Agent 配置 → Agent 专属知识库：管理该 Agent 的经验/案例。
- 房间设置 → 知识：管理当前房间知识库。

移动端交互要求：

- 列表为卡片式。
- 新增/编辑使用底部弹层。
- 标题、标签、内容分区清晰。
- 删除需要确认。

## 安全边界

- 公共知识库写权限仅 admin。
- Agent 专属知识库写权限仅 Agent owner/admin。
- 房间知识库写权限仅房间 owner/editor/admin。
- Agent Runtime 只能获取 `public + 当前 agent + 当前 room` 三类知识。

## 后续扩展

- 文件导入：从房间文件、PDF/Word/Excel 等由 Agent Client 解析后入库。
- 待确认知识：Agent 只提交建议，owner 审核后正式入库。
- 版本与引用：记录知识来源、修订历史、引用命中。
- 向量索引：为 `knowledge_entries` 增加 embeddings/FTS 索引。
