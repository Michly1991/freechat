# FreeChat Remote Claude Agent Example

This example runs a FreeChat Agent on another server. The remote server must have Claude Code installed and configured locally.

这个示例用于在另一台服务器上运行 FreeChat Agent。远程服务器需要自行安装并配置 Claude Code。

## What FreeChat does not need

FreeChat does **not** need your remote model API key.

FreeChat 不需要远程服务器的模型 API Key。

The remote machine owns:

```bash
claude
~/.claude/settings.json
ANTHROPIC_API_KEY or other local model config
```

FreeChat only receives connector credentials created through pairing.

## 1. Check and install Claude Code / 检查并安装 Claude Code

Run on the remote server:

```bash
pnpm run check:claude
```

If Claude Code is missing:

```bash
npm install -g @anthropic-ai/claude-code
claude -p "hello"
```

China mainland users often also need `cc-switch` to manage Claude Code provider endpoints:

```bash
npm install -g cc-switch
cc-switch
```

经验说明：FreeChat 不接收远程机器的模型 API Key。请在远程服务器本机完成 Claude Code / cc-switch / `~/.claude/settings.json` 配置，确认 `claude -p "hello"` 可以运行后，再接入 FreeChat。

## 2. Local Claude smoke test / 本地 Claude 自测

```bash
pnpm run smoke:claude
```

This script creates a temporary FreeChat-like workspace with a mock `./freechat` command, then runs local `claude -p` inside it. It verifies that the remote server can execute Claude Code in the same style used by the connector.

该脚本会创建临时 FreeChat 风格工作区和 mock `./freechat` 命令，然后在其中运行本机 `claude -p`，用于验证远程服务器能否按连接器方式执行 Claude Code。

## 3. Pair / 配对

Create a pairing code in FreeChat Agent settings, then run:

```bash
pnpm install
pnpm build
node dist/index.js pair --server https://freechat.example.com --code ABCD-1234
```

Credentials are saved locally under:

```text
~/.freechat/remote-claude-agent/credentials.json
```

## 4. Connect / 连接

```bash
node dist/index.js connect
```

The client polls FreeChat events, runs local `claude -p`, and writes results back through FreeChat Agent tools.

## Environment

```bash
FREECHAT_REMOTE_AGENT_HOME=/opt/freechat-remote-agent/state
FREECHAT_INSTANCE_ID=worker-1
FREECHAT_POLL_INTERVAL_MS=3000
FREECHAT_CLAUDE_MODEL=qwen3.7-max
```

## Commands available to Claude Code

Inside the generated workspace, Claude Code can use:

```bash
./freechat chat send "message"
./freechat tool task.list '{}'
./freechat tool file.write '{"path":"reports/result.md","content":"..."}'
./freechat members list
./freechat room info
```

## systemd

See `deploy/freechat-remote-claude-agent.service`.
