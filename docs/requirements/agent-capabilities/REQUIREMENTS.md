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
