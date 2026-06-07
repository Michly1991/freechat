# FreeChat - AI协同办公云系统

AI-driven collaborative workspace with real-time chat, file management, task tracking, and dynamic UI panels.

## 项目状态

🚧 **开发中** - MVP 第一阶段

## 已完成

- [x] Monorepo 项目结构（pnpm workspace）
- [x] Shared 包：TypeScript 类型定义、常量、任务状态机
- [x] Server 包：Fastify + WebSocket + SQLite
  - [x] 用户认证（注册/登录/JWT）
  - [x] 房间管理（创建/成员/权限）
  - [x] 聊天消息（发送/历史/编辑/删除，最多50条）
  - [x] 任务看板（8种状态）
  - [x] WebSocket 网关（实时通信）
- [x] Web 包：React + Vite + Zustand + Tailwind
  - [x] 登录/注册页面
  - [x] 首页（项目列表）
  - [x] 房间页面（聊天/任务）
  - [x] 个人设置页面
  - [x] 移动端响应式布局

## 待完成

- [ ] 文件系统（文件树/上传/编辑）
- [ ] 动态 UI（Tab 管理/iframe 渲染）
- [ ] @提及功能（高亮/通知/成员选择器）
- [ ] Agent 系统（Claude Code 集成）
- [ ] Agent 市场
- [ ] 多 Agent 协作
- [ ] 成员角色系统
- [ ] 文件操作（mkdir/rename）
- [ ] Docker 部署

## 技术栈

**后端**
- Node.js 20 + Fastify 5 + ws
- SQLite (better-sqlite3)
- JWT 认证
- TypeScript 5

**前端**
- React 18 + Vite 5
- Zustand 状态管理
- Tailwind CSS 3
- React Router 6

**Agent 系统**
- Claude Code CLI v2.1.168
- 通义千问 qwen3.7-max（通过阿里云百炼 Anthropic 兼容接口）
- MCP 协议
- 每个房间一个 Claude Code session

## 快速开始

### 1. 安装依赖

```bash
pnpm install
cd packages/shared && pnpm build
```

### 2. 配置环境变量

创建 `packages/server/.env`：

```bash
PORT=3001
HOST=0.0.0.0
JWT_SECRET=***
CORS_ORIGIN=*
DB_PATH=./data/freechat.db
WORKSPACE_ROOT=./workspace-data
ANTHROPIC_API_KEY=你的阿里云百炼API_Key
ANTHROPIC_BASE_URL=https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic
ANTHROPIC_MODEL=qwen3.7-max
```

### 3. 配置 Claude Code CLI

创建 `~/.claude/settings.json`：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
    "ANTHROPIC_API_KEY": "你的阿里云百炼API_Key",
    "ANTHROPIC_MODEL": "qwen3.7-max"
  }
}
```

**重要**：
- 使用阿里云百炼的 Anthropic 兼容接口
- 模型名称必须是 `qwen3.7-max`（不是 Claude 系列）
- API Key 从阿里云百炼控制台获取

测试配置：
```bash
claude -p "你好" --model qwen3.7-max
```

### 4. 启动开发服务器

```bash
cd packages/server && pnpm dev  # 后端 http://localhost:3001
cd packages/web && pnpm dev    # 前端 http://localhost:5173
```

## 项目结构

```
freechat/
├── packages/
│   ├── shared/    # 共享类型和常量
│   ├── server/    # Fastify 后端
│   └── web/       # React 前端
├── workspace-data/ # 运行时数据（gitignore）
└── docs/design/   # 设计文档
```

## 设计文档

- [系统设计总览](docs/design/DESIGN-OVERVIEW.md)
- [原始需求](docs/design/DESIGN.md)
- [技术架构](docs/design/ARCHITECTURE.md)
- [Agent 体系](docs/design/DESIGN-AGENT.md)
- [Agent 调度](docs/design/DESIGN-AGENT-SCHEDULER.md)
- [多 Agent 协作](docs/design/DESIGN-AGENT-COLLABORATION.md)
- [成员角色系统](docs/design/DESIGN-MEMBER-PROFILES.md)

## 核心特性

1. **实时通信** - WebSocket 双向消息，支持聊天/文件/任务/UI 操作
2. **隔离项目空间** - 每个房间独立目录，物理隔离
3. **动态 UI 引擎** - Tab 页签为 HTML，支持热更新
4. **智能 @提及** - 精准通知，触发 Agent 唤醒
5. **人机平权** - 人类和 Agent 使用相同 API

## 任务状态机

```
todo → assigned → doing → review → done
                        ↓
                      blocked / failed
                        ↓
                      cancelled
```

## Agent 架构

- **助理 Agent**：每个房间一个，拍板决策、分配任务
- **专家 Agent**：执行具体工作，可创建子任务
- **AI 模型**：通义千问 qwen3.7-max（通过阿里云百炼 Anthropic 兼容接口）
- **Claude Code CLI**：每个房间一个 session，通过 `--resume` 保持上下文
- **MCP 工具**：Agent 通过 MCP 调用系统功能

### Agent 工作流程

1. 监听房间消息
2. 判断是否需要响应
3. 调用 Claude Code CLI 执行任务
4. 返回结果到房间

## License

MIT
