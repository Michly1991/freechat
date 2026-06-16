# Agent 梦境成长设计

## 目标

每天夜间合并执行 Agent 梦境复盘与成长复盘：

- **梦境复盘**：根据 Agent 当天运行失败和工具错误，生成安全、可追踪、可去重的避错规则，写回 `agent.config.dreamMemory`，帮助 Agent 第二天减少同类错误。
- **成长复盘**：根据用户消息和协作行为提炼“用户习惯 / 项目偏好 / 协作边界”候选记忆，经用户确认后写入 `agent_memories`，下一次 Agent 运行时注入 prompt，让 Agent 越来越贴合用户习惯。

## 第一版范围

- 梦境：自动分析 `agent_runs` 和 `agent_tool_calls`，只自动应用安全规则到 `agent.config.dreamMemory`。
- 成长：规则分析用户消息，生成候选记忆；默认不自动采纳，必须用户确认。
- 不直接改 Agent 原始 `description`。
- 不直接改 Skill 正文。
- 不自动修改 Agent 工具权限。
- 不自动跨项目传播用户级记忆。
- 记录 `agent_dreams` / `agent_dream_fixes` 和 `agent_growth_reviews` / `agent_memory_proposals` / `agent_memories`，方便追踪与撤销。
- 房间设置页合并展示“梦境成长”，支持手动运行梦境复盘和成长建议。

## 数据表

梦境：

- `agent_dreams`：每个房间/Agent/日期一条复盘记录。
- `agent_dream_fixes`：记录梦境写入的避错规则、原因和前后文本。

成长：

- `agent_growth_reviews`：每个房间/日期一条成长复盘记录。
- `agent_memory_proposals`：候选记忆，状态为 `pending / accepted / rejected`。
- `agent_memories`：已采纳并生效的项目/Agent 记忆，支持软删除 `enabled=0`。

## 安全规则类型

第一版只处理明确可自动修复的错误模式：

- `project_path_rule`：写错项目路径或写入私有/系统目录。
- `html_publish_rule`：HTML 文件未正确发布为页面。
- `tool_validation_rule`：工具参数缺失或格式错误。
- `task_progress_rule`：任务状态/进展流转风险。
- `self_identity_rule`：Agent 自我识别混淆。

## Agent 提示词接入

`agent.config.dreamMemory` 会渲染到：

- Agent system prompt 的“梦境复盘得到的避错规则”。
- Agent 工作区 `AGENT.md` / `CLAUDE.md` 的“梦境复盘避错规则”。

已采纳的 `agent_memories` 会按 `room_id + 当前 agent_id` 过滤后渲染到：

- Agent system prompt 的“用户习惯与项目记忆”。
- Agent 工作区 `AGENT.md` / `CLAUDE.md` 的“用户习惯与项目记忆”。

第一版最多注入 12 条，避免 prompt 膨胀。

## 调度

环境变量：

```env
AGENT_DREAM_ENABLED=true
AGENT_DREAM_RUN_HOUR=3
AGENT_DREAM_RUN_MINUTE=30
AGENT_DREAM_AUTO_APPLY_SAFE_FIXES=true

AGENT_GROWTH_ENABLED=true
AGENT_GROWTH_RUN_HOUR=4
AGENT_GROWTH_RUN_MINUTE=10
```

后端启动后每小时检查一次，到达每日运行时间后执行昨天的梦境复盘，并用 `agent_dreams(room_id, agent_id, dream_date)` 防止同日重复记录膨胀。

## API

梦境：

```http
GET /api/agent-dreams?roomId=<roomId>
GET /api/agent-dreams/:id
POST /api/agent-dreams/run
```

成长：

```http
GET /api/rooms/:roomId/agent-growth
POST /api/rooms/:roomId/agent-growth/run
POST /api/agent-growth/proposals/:id/accept
POST /api/agent-growth/proposals/:id/reject
DELETE /api/agent-growth/memories/:id
```

`POST /api/agent-dreams/run` 支持：

```json
{ "roomId": "optional", "agentId": "optional", "date": "YYYY-MM-DD", "dryRun": false }
```
