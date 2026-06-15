# DESIGN-AGENT-RUNTIME-TIMEOUTS

## 背景

Agent 运行分为几类：

- 轻量调度判断：判断用户消息是否应拆成长任务。
- 普通聊天回复：Agent 直接回复聊天室。
- 长任务子任务：Agent 执行文件/任务/产物交付。

之前轻量调度判断也走 Claude Code CLI，导致简单 JSON 判断可能因 CLI 启动、恢复上下文或模型长思考而 45s 超时。Claude Code `--output-format json` 在完成前不输出 stdout，因此超时时常见错误是：

```text
Claude Code timed out after ... Partial output:
```

## 超时分层

默认值：

```text
AGENT_DECIDER_TIMEOUT_MS=15000
AGENT_CHAT_TIMEOUT_MS=180000
AGENT_TASK_TIMEOUT_MS=600000
```

含义：

- Decider：15s，失败快速降级为普通聊天。
- Chat：180s，给创作类普通回复更多空间。
- Task：600s，允许长任务子任务执行较久。

## 调度判断器

`longTaskService.decideWithAgent()` 不再启动 Claude Code CLI。

它改为直接调用当前 AI Provider 的 Anthropic-compatible `/v1/messages`：

- 无工具权限。
- 不恢复 Claude session。
- `max_tokens=768`。
- 使用 `AbortController` 做 15s 超时。
- 失败时返回：

```json
{ "mode": "chat", "confidence": 0, "reason": "planner failed fast: ..." }
```

这样调度判断不会阻塞用户消息太久，也不会产生 Agent CLI timeout run。

## Claude Code CLI

Claude Code CLI 继续用于：

- 普通 Agent 聊天执行。
- 长任务子任务执行。
- 需要 `./freechat` App Tools 的场景。

后续如果 Claude Code 支持 `stream-json`，可继续优化为运行过程事件流，而不是等待最终 JSON。
