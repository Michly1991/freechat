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

## Pair

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

## Connect

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
