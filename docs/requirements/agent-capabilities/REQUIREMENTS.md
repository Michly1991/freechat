# FreeChat Agent 能力文件要求

## Skill 文件大小

- Skill 文件必须控制在 500 行以内。
- Skill/Markdown 能力说明只保留必要说明和入口指引。
- 长脚本、长 API 清单、模板、参考资料必须拆到：
  - `scripts/`
  - `res/`
  - 其他明确资源目录。

## Agent 能力职责拆分

- 不要把复杂逻辑堆进单个 Skill 或单个 Markdown。
- 推荐拆分：
  - `SKILL.md`：触发场景、使用方式、安全边界。
  - `scripts/`：可执行脚本。
  - `res/`：模板、API 清单、长参考资料。
  - `examples/`：示例输入输出。

## 知识库同步要求

- Agent 知识库由 FreeChat Server 统一维护。
- 支持上传/新建、编辑、修改、删除、重建索引等基础操作。
- Agent Client 不是知识库主存储，只在运行前从 Server 同步到本地 `.freechat/knowledge/` 供 Agent 按需读取。

## Agent Client 运行回复要求

- 普通最终回复可以由 Agent Client 自动发送；但如果 Agent 已调用 `./freechat chat send` 或 `./freechat room handoff` 等会产生用户可见消息/转接的工具，最终 stdout 只能是简短摘要，不能重复完整回复。
- `final_to_chat` 运行中，“我先查询/正在执行/让我看看”等中间进展不应被当成最终回复自动发送。
- 长驻 Agent Client 应使用原始 connector token 调用远端 heartbeat/events/runtime/complete/fail/tool 接口；短期 access JWT 只作为便捷访问令牌，不能成为长期绑定失效的单点。
- 远程 Agent 可选择两种接入方式：使用服务端下发的 `./freechat` CLI，或直接调用 Remote Agent HTTP API。两者必须走同一套 `/api/remote-agents/app-call` 授权、审计和权限兜底。
