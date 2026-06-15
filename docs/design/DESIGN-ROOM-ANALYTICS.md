# 房间分析设计

## 目标

房间设置页提供“分析”模块，用于观察本房间内 Agent 的运行成本和工具健康度：

- 房间级 token 总览。
- 每个 Agent 的 input/output token，也就是前 token / 后 token。
- Agent 单次运行耗时和状态。
- 每个工具调用耗时。
- 工具报错分析：失败次数、失败率、错误码聚合、最近错误。

## 术语

- 前 token：模型上报的 `input_tokens` / `prompt_tokens`。
- 后 token：模型上报的 `output_tokens` / `completion_tokens`。
- cache token：模型上报的 `cache_creation_input_tokens`、`cache_read_input_tokens`。
- 总 token：前 token + 后 token + cache creation token + cache read token。
- Agent 耗时：`agent_runs.started_at` 到 `finished_at` 的毫秒数。
- 工具耗时：服务端收到 `/api/agent-tools/:roomId` 请求到工具返回/报错的毫秒数。

## 数据采集

### Agent 运行

`agent_runs` 在 Agent 被唤起时创建，完成时写入：

- `runtime`：`claude-code` 或 `provider-api`。
- `model`：Provider API 模式下记录模型名；Claude Code 模式目前可能为空。
- `duration_ms`。
- `input_tokens`。
- `output_tokens`。
- `cache_creation_input_tokens`。
- `cache_read_input_tokens`。
- `total_tokens`。
- `tool_call_count`。
- `tool_duration_ms`。

Claude Code CLI 使用 `--output-format stream-json --verbose`，服务端解析 JSONL 中可能出现的 usage 字段。兼容位置包括：

- `item.message.usage`
- `item.usage`
- `item.result.usage`
- `item.result.message.usage`
- `item.response.usage`

如果运行时没有返回 usage，则 token 字段为 0，前端显示为 0，不做估算，避免假数据。

### 工具调用

所有 Agent App Tools 统一通过 `/api/agent-tools/:roomId` 进入。该入口在执行前创建 `agent_tool_calls` 记录，执行后写入成功/失败、错误码、错误信息和耗时。

工具调用会归属到当前房间、当前 Agent 的最新 running run；若没有 active run，则仍记录工具调用，但 `run_id` 可以为空。

## 数据表

### agent_runs 扩展字段

```sql
runtime TEXT;
model TEXT;
duration_ms INTEGER;
input_tokens INTEGER DEFAULT 0;
output_tokens INTEGER DEFAULT 0;
cache_creation_input_tokens INTEGER DEFAULT 0;
cache_read_input_tokens INTEGER DEFAULT 0;
total_tokens INTEGER DEFAULT 0;
tool_call_count INTEGER DEFAULT 0;
tool_duration_ms INTEGER DEFAULT 0;
```

### agent_tool_calls

```sql
CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  run_id TEXT,
  stream_id TEXT,
  tool_name TEXT NOT NULL,
  action TEXT,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  input_summary TEXT,
  output_summary TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER
);
```

索引用于按房间、Agent、run、工具名、状态、错误码聚合查询。

## API

### 房间分析总览

```http
GET /api/rooms/:roomId/analytics?from=...&to=...
```

返回：

- `summary`：房间总体运行次数、token、耗时、工具次数。
- `agents`：按 Agent 聚合的 token 和耗时。
- `tools`：按工具聚合的调用次数、失败次数、失败率、耗时。
- `errorCodes`：按工具和错误码聚合的失败统计。
- `recentErrors`：最近 20 条工具错误。

### 运行列表

```http
GET /api/rooms/:roomId/analytics/runs?agentId=...&page=1&pageSize=20
```

返回运行摘要，供设置页展示最近运行。

### 运行详情

```http
GET /api/rooms/:roomId/analytics/runs/:runId
```

返回单次运行的完整输入/输出/错误、token 明细和关联工具调用列表。

## 前端入口

入口放在“房间设置”页，不占用房间主聊天导航。

组件拆分：

```text
packages/web/src/features/analytics/RoomAnalyticsPanel.tsx
```

页面内容：

1. 总览卡片。
2. Agent token 用量表。
3. 工具耗时与失败率卡片。
4. 工具报错分析。
5. 最近运行和运行详情弹层。

移动端使用卡片和底部弹层，避免宽表格撑破屏幕。

## 权限

第一版按房间成员可见：只要 `roomService.isMember(roomId, user.id)` 为 true，就可以查看分析。

## 后续优化方向

- 增加费用折算，按模型配置单价统计成本。
- 对高失败率工具生成优化建议。
- 按天/周趋势图展示 token 和错误率变化。
- 支持导出 CSV。
