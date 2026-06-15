# 个人全局分析设计

## 目标

在个人设置页提供“全局分析”，跨项目统计当前用户相关 Agent 的 token、运行耗时、工具调用和工具错误。它与房间设置页的“房间分析”互补：

- 房间分析回答“这个项目消耗了多少”。
- 个人全局分析回答“我相关的所有项目里，各个 Agent 消耗了多少”。

## 第一版统计口径

默认口径为 `member`：当前用户参与的所有房间。

```sql
agent_runs.room_id IN (
  SELECT room_id FROM room_members WHERE user_id = :currentUserId
)
```

同时支持：

- `owned`：当前用户创建的房间。
- `triggered`：当前用户本人触发的 Agent run。

`triggered` 依赖新增字段 `agent_runs.actor_user_id`，历史数据为空，只能统计字段上线后的新运行。

## Agent 聚合规则

项目内 Agent 通常由模板克隆而来。个人全局分析按模板归并：

```sql
COALESCE(agents.source_template_id, agent_runs.agent_id)
```

因此同一个 Agent 模板在多个项目里的副本会聚合成一行，同时返回：

- `agentInstanceCount`：实际项目内 Agent 副本数量。
- `roomCount`：涉及项目数量。

## 数据采集补充

`agent_runs` 新增：

```sql
actor_user_id TEXT
```

Agent runtime 创建 run 时从 `options.actorUserId` 写入该字段。历史数据为空，不做回填，避免错误归因。

## API

### 全局分析总览

```http
GET /api/me/analytics?scope=member|owned|triggered&from=...&to=...
```

返回：

- `summary`：房间数、Agent 数、实例数、run 数、token、耗时、工具失败率。
- `agents`：按 Agent 模板聚合的消耗排行。
- `rooms`：按项目聚合的消耗排行。
- `tools`：工具健康度。

### 最近运行

```http
GET /api/me/analytics/runs?scope=member&page=1&pageSize=20&agentKey=...&roomId=...
```

返回当前 scope 下可见的 Agent 运行摘要。

### 运行详情

```http
GET /api/me/analytics/runs/:runId
```

只允许查看当前用户参与房间里的 run，防止通过 runId 越权。

## 前端入口

入口位于个人设置页顶部：

```text
个人设置
├── 全局分析
├── 基本信息
├── 修改密码
└── 退出登录
```

组件：

```text
packages/web/src/features/analytics/PersonalAnalyticsPanel.tsx
packages/web/src/features/analytics/analytics-format.tsx
```

显示内容：

1. 总览卡片：总 token、前/后 token、调用次数、项目/Agent 数、工具失败率。
2. 各 Agent 消耗排行。
3. 项目消耗排行，点击跳转房间设置分析。
4. 工具健康度。
5. 最近运行和运行详情弹层。

## 权限

- `member` / `owned` / `triggered` 都只返回当前用户可访问范围内的数据。
- 运行详情固定校验 `room_members`，不能越权查看非成员房间的运行详情。

## 后续优化

- 增加趋势图，例如每日 token 和工具失败率。
- 增加费用折算。
- 对高失败率工具生成优化建议。
- 支持 CSV 导出。
