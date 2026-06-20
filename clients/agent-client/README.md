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
