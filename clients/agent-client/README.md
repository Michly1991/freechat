# FreeChat Agent Client

独立的 FreeChat Agent 执行客户端。它连接一个 FreeChat Server，但可以在本客户端内管理多个 Agent 登录、启停、配置和运行日志。

## 端口

默认管理网页/API：

```bash
http://127.0.0.1:5188
```

避免和 FreeChat Server `3001`、FreeChat Web `5173` 冲突。公网访问时显式配置：

```bash
AGENT_CLIENT_HOST=0.0.0.0
AGENT_CLIENT_PORT=5188
AGENT_CLIENT_ADMIN_PASSWORD='strong-password'
```

建议用 Nginx/Caddy 反向代理 HTTPS 到 `127.0.0.1:5188` 或内网地址。

## 启动

```bash
pnpm install
pnpm --filter @freechat/agent-client dev
```

或构建后运行：

```bash
pnpm --filter @freechat/agent-client build
pnpm --filter @freechat/agent-client start
```

## 配对多个 Agent

在 FreeChat 主站为每个 Agent 生成配对码，然后在客户端网页的 Agent 管理页添加；也可以用 CLI：

```bash
node dist/main.js pair --server http://localhost:3001 --code ABCD-1234 --name 专家A
node dist/main.js pair --server http://localhost:3001 --code WXYZ-9876 --name 专家B
```

客户端只配置一个 `FREECHAT_SERVER_URL`，多个 Agent 都登录这个服务器。

## 安全

- 公网模式必须配置管理员密码，否则拒绝启动。
- connector token、API Key 等敏感信息不在网页明文展示。
- 默认只监听 `127.0.0.1`。
- 推荐通过 HTTPS 反向代理公开访问。


## 常驻服务

本仓库提供用户级 systemd 模板：

```bash
mkdir -p ~/.config/systemd/user
cp clients/agent-client/deploy/freechat-agent-client.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now freechat-agent-client.service
systemctl --user status freechat-agent-client.service
```

当前测试环境已启用 `freechat-agent-client.service`，监听 `0.0.0.0:5188`，默认自动接收请求。

## 自检

```bash
pnpm --filter @freechat/agent-client check:client
pnpm --filter @freechat/agent-client check:claude
```

`check:client` 会检查控制台可访问、管理员登录、状态接口和环境检测接口。

## Agent 知识库按需加载

FreeChat Server 是 Agent 自有知识库和通用公共知识的主存储。Agent Client 每次运行只拿目录摘要和工具说明，不把知识库全文预先放进 Claude 上下文。

运行时 Agent 可用：

```bash
./freechat knowledge list
./freechat knowledge search "关键词" --limit 8
./freechat knowledge read <fileId-or-path>
./freechat knowledge read public:<entryId>
```

规则：先 search，再 read 少量命中内容；Agent 自有知识优先，通用公共知识作为补充。房间内克隆 Agent 会继承通讯录 root Agent 的知识库。

## Claude 会话上下文

Agent Client 会为每个 Agent + Room 保存短期 Claude Code session，用于连续请求时复用本地上下文。默认 TTL 为 5 分钟，可通过环境变量调整：

```bash
FREECHAT_AGENT_CLIENT_SESSION_TTL_MS=300000
```

如果 Claude Code 返回 422、context length、prompt too long、token limit 等上下文超长错误，客户端会自动：

1. 删除当前房间的 `.freechat/claude-session.json`。
2. 不带 `--resume` 重新执行本次请求一次。
3. 将恢复动作记录到 run activity。

这里没有自动发送 `/compact` 指令，因为当前客户端使用 `claude -p` 非交互模式执行，清 session 后 fresh retry 更确定、更容易验证。

## SDK / 协议文档

如果要自己实现 Agent Client 或接入第三方运行时，请看 [SDK.md](./SDK.md)。
