# Agent 梦境复盘设计

## 目标

每天夜间根据 Agent 当天运行失败和工具错误，生成“梦境复盘”，把安全、可追踪、可去重的避错规则写回 `agent.config.dreamMemory`，帮助 Agent 第二天减少同类错误。

## 第一版范围

- 自动分析 `agent_runs` 和 `agent_tool_calls`。
- 只自动应用安全规则到 `agent.config.dreamMemory`。
- 不直接改 Agent 原始 `description`。
- 不直接改 Skill 正文。
- 记录 `agent_dreams` 和 `agent_dream_fixes`，方便追踪。
- 房间设置页展示最近梦境，并支持手动复盘。

## 数据表

- `agent_dreams`：每个房间/Agent/日期一条复盘记录。
- `agent_dream_fixes`：记录梦境写入的避错规则、原因和前后文本。

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

## 调度

环境变量：

```env
AGENT_DREAM_ENABLED=true
AGENT_DREAM_RUN_HOUR=3
AGENT_DREAM_RUN_MINUTE=30
AGENT_DREAM_AUTO_APPLY_SAFE_FIXES=true
```

后端启动后每小时检查一次，到达每日运行时间后执行昨天的梦境复盘，并用 `agent_dreams(room_id, agent_id, dream_date)` 防止同日重复记录膨胀。

## API

```http
GET /api/agent-dreams?roomId=<roomId>
GET /api/agent-dreams/:id
POST /api/agent-dreams/run
```

`POST /api/agent-dreams/run` 支持：

```json
{ "roomId": "optional", "agentId": "optional", "date": "YYYY-MM-DD", "dryRun": false }
```
