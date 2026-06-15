# 长任务拆分与可恢复执行设计

## 目标

长任务不另起一套任务系统，而是作为现有任务体系的一种执行模式：自动识别、创建父任务和串行子任务、逐步执行、每步落盘、失败只影响当前子任务。

## 触发

自动助理收到用户消息时，先让当前房间助理做一次轻量“执行模式判断”。判断器只输出 JSON，不执行任务：

```json
{
  "mode": "chat | long_task",
  "confidence": 0.8,
  "reason": "判断原因",
  "title": "父任务标题",
  "artifactRoot": "res/目录",
  "items": [
    { "title": "子任务标题", "description": "说明", "artifactPath": "res/目录/文件.md" }
  ]
}
```

如果判断为 `long_task`，后端把 JSON 计划落到现有任务体系；如果判断为 `chat`，继续普通聊天。

## 数据复用

复用现有表和链路：

- 父任务：`tasks`
- 子任务：`task_items`
- 依赖：`task_item_dependencies`
- Agent 运行：`agent_runs`
- 唤醒：现有 task reason 调用，使用 `taskTimeoutMs`
- 文件产物：继续写入项目 `res/` 或 `files/`

## 执行策略

- 创建父任务，description 标记 `[LONG_TASK]`。
- 按主题创建串行子任务。
- 第一个子任务为 `assigned`，后续子任务为 `blocked` 并依赖前一个子任务。
- 子任务完成后，现有 `agentTaskCompletionService` 会释放下游子任务并唤醒 Agent。
- 某个子任务超时或失败时，只影响该子任务；已完成子任务和文件产物保留。

## 文件落盘

长任务产物必须进入项目可见文件目录，而不是只留在 Agent 私有工作区。

- Agent 可以先在自己的 `res/` 中生成草稿或中间文件。
- 最终交付必须调用项目文件 API/CLI：
  - `./freechat file write-local <项目文件路径> <本地文件路径> --show`
  - 或 `./freechat file write <项目文件路径> <内容> --show`
- 直接写 `res/` 只会落在 `workspace-data/<roomId>/agents/<agentId>/res/`，用户在项目“文件”目录看不到。
- `--show` 会把文件加入文件 Tab 配置，确保前端文件树可见。
- 后端有兜底发布：任务提示中出现 `产物路径：...` 时，Agent 运行结束后会检查 `workspace-data/<roomId>/agents/<agentId>/<产物路径>`；如果文件存在，自动复制到 `workspace-data/<roomId>/files/<产物路径>` 并加入文件 Tab。

长任务子任务说明中必须包含产物路径，例如：

```text
res/长篇创作设定与整合/00-设定索引.md
res/长篇创作设定与整合/01-世界观与势力.md
res/长篇创作设定与整合/99-最终整合版.md
```

Agent 子任务提示要求：只处理当前子任务，先写本地草稿，再通过 `file write-local --show` 发布到项目文件目录；聊天只返回摘要、项目文件路径和下一步。

## 子任务完成与继续唤醒

子任务的完成判断由 `agentTaskCompletionService` 根据 Agent 输出做兜底识别。包含“完成/已保存/写入”等正向信号时可自动标记完成；只有“无法完成/未完成/任务失败/产物失败/写入失败/保存失败”等硬失败才阻止完成。避免因为“CLI 报错无法更新任务状态，但文件已保存”这类非产物失败导致链路卡住。

串行子任务释放后，后端必须唤醒下游子任务的 assignee。即使下游还是同一个 Agent，也要继续唤醒；同一 Agent 的串行长任务不能因为 `assigneeId === assigningAgentId` 被跳过。

## 当前落地范围

Phase 1 只拦截自动助理入口的明显长任务：

1. `longTaskService.decideWithAgent()` 让当前助理判断执行模式并输出 JSON。
2. `longTaskService.createPlan()` 将 JSON 计划创建为父任务和串行子任务。
3. 聊天中发送任务拆分摘要。
4. 第一个子任务立即用 task reason 唤醒助理。
5. 后续子任务复用现有依赖释放和唤醒机制。

暂不处理直接 @ 专家的一次性长消息；后续可扩展到 mention 入口。
