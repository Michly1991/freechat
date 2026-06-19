# FreeChat - AI Collaborative Workspace / AI 协同办公空间

FreeChat is an AI-native collaborative workspace where humans and agents work in the same rooms, share the same task board, operate on the same project files, and communicate through the same real-time protocol.

FreeChat 是一个 AI 原生协同办公空间：人类和 Agent 在同一个项目房间里协作，共享聊天、任务、文件和动态页面，并通过统一的实时协议完成工作。

> Status: Active development. The current version is suitable for local/private deployment, product validation, and agent collaboration experiments.
>
> 状态：持续开发中。当前版本适合本地/私有化部署、产品验证和 Agent 协作实验。

---

## Why FreeChat / 为什么做 FreeChat

Most collaboration tools were designed for humans first, then added AI as a chat box. FreeChat takes a different path: agents are treated as collaborators, not plugins. They can read context, receive tasks, update progress, create files, and participate in project workflows.

大多数协作工具先为人类设计，再把 AI 当成聊天框补进去。FreeChat 的思路不同：Agent 是协作者，不是插件。它们可以读取上下文、接收任务、更新进度、创建文件，并参与完整项目流程。

The goal is to build a lightweight operating space for future human-agent teams.

目标是打造一个轻量级的人机协作工作空间。

---

## Core Features / 核心特性

- **Real-time project rooms / 实时项目房间**
  - WebSocket-based chat, presence, task updates, file events, and UI events.
  - 基于 WebSocket 的聊天、在线状态、任务变更、文件事件和 UI 事件。

- **Human-agent collaboration / 人机协作**
  - Humans and agents share the same room context and collaboration model.
  - 人类和 Agent 共享同一个房间上下文和协作模型。

- **Agent system / Agent 系统**
  - Built-in assistant agent, custom room agents, agent skills, runtime configuration, and observable agent runs.
  - 支持内置助理、自定义房间 Agent、Agent Skill、运行时配置和 Agent 执行记录。

- **Task board / 任务看板**
  - Task lifecycle: `todo → assigned → doing → review → done`, with blocked/failed/cancelled states.
  - 支持 `todo → assigned → doing → review → done` 的任务流转，以及 blocked/failed/cancelled 状态。

- **Project files / 项目文件**
  - Each room has an isolated workspace for files, pages, and agent-generated artifacts.
  - 每个房间拥有独立工作区，用于存放项目文件、页面和 Agent 生成内容。

- **Dynamic UI tabs / 动态 UI 页签**
  - Rooms can render HTML-based tabs for generated pages, previews, and lightweight tools.
  - 房间可以渲染基于 HTML 的页签，用于生成页面、预览和轻量工具。

- **Responsive web app / 响应式 Web 应用**
  - React + Tailwind UI optimized for desktop and mobile usage.
  - 基于 React + Tailwind，适配桌面端和移动端。

---

## Tech Stack / 技术栈

### Backend / 后端

- Node.js 20+
- Fastify 5
- WebSocket / `ws`
- SQLite / `better-sqlite3`
- JWT authentication
- TypeScript

### Frontend / 前端

- React 18
- Vite 5
- Zustand
- Tailwind CSS
- React Router
- TypeScript

### Agent Runtime / Agent 运行时

- Claude Code CLI compatible runtime
- Anthropic-compatible model endpoint
- Qwen `qwen3.7-max` via Alibaba Cloud Model Studio / DashScope-compatible Anthropic API
- MCP-style tool integration

---

## Architecture / 架构概览

```text
freechat/
├── packages/
│   ├── shared/       # Shared TypeScript types and constants / 共享类型和常量
│   ├── server/       # Fastify backend, WebSocket gateway, SQLite / 后端服务
│   └── web/          # React frontend / 前端应用
├── docs/design/      # System design documents / 系统设计文档
└── workspace-data/   # Runtime project workspaces, ignored by git / 运行时项目数据
```

High-level flow:

整体流程：

```text
Browser / 浏览器
  ↓ HTTP + WebSocket
FreeChat Server / FreeChat 后端
  ↓ SQLite + workspace files
Room state, messages, tasks, files / 房间状态、消息、任务、文件
  ↓ Agent invocation
Agent runtime / Agent 运行时
  ↓ model/tool calls
AI model + tools / AI 模型与工具
```

---

## Quick Start / 快速开始

### 1. Install dependencies / 安装依赖

```bash
pnpm install
pnpm --filter @freechat/shared build
```

### 2. Configure environment variables / 配置环境变量

Create `packages/server/.env`:

创建 `packages/server/.env`：

```bash
PORT=3001
HOST=0.0.0.0
JWT_SECRET=change-me
CORS_ORIGIN=*
DB_PATH=./data/freechat.db
WORKSPACE_ROOT=./workspace-data

# Anthropic-compatible model endpoint / Anthropic 兼容模型接口
ANTHROPIC_API_KEY=your-api-key
ANTHROPIC_BASE_URL=https://your-anthropic-compatible-endpoint
ANTHROPIC_MODEL=qwen3.7-max
```

### 3. Configure Claude Code CLI / 配置 Claude Code CLI

Create or update `~/.claude/settings.json`:

创建或更新 `~/.claude/settings.json`：

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-anthropic-compatible-endpoint",
    "ANTHROPIC_API_KEY": "your-api-key",
    "ANTHROPIC_MODEL": "qwen3.7-max"
  }
}
```

Test the configuration:

测试配置：

```bash
claude -p "Hello" --model qwen3.7-max
```

### 4. Start development servers / 启动开发服务

Recommended from the repository root:

推荐在仓库根目录执行：

```bash
pnpm --filter @freechat/server dev
pnpm --filter @freechat/web dev --host 0.0.0.0
```

Default URLs:

默认地址：

- Web app / 前端：`http://localhost:5173`
- API health check / 后端健康检查：`http://localhost:3001/api/health`

For local-only development, `pnpm dev` can start workspace dev scripts together, but running server and web separately is often easier to debug.

本地开发也可以使用 `pnpm dev` 同时启动 workspace 中的 dev 脚本；但分开启动前后端更便于排查问题。

---

## Agent System / Agent 系统

FreeChat treats agents as first-class collaborators.

FreeChat 将 Agent 视为一等协作者。

Key concepts:

核心概念：

- **Default assistant / 默认助理**：a built-in room assistant responsible for understanding user intent and coordinating work.
- **Custom agents / 自定义 Agent**：users can create agents with their own roles, skills, prompts, and runtime configuration.
- **Skills and scripts / Skill 与脚本**：agent capabilities can be described as skills, with executable logic separated into scripts when needed.
- **Task-driven execution / 任务驱动执行**：longer work can be split into tasks and subtasks, then assigned to agents.
- **Observable runs / 可观测执行记录**：agent runs are recorded for status tracking and troubleshooting.

Multi-agent collaboration follows conservative routing rules to avoid noisy loops: human messages can explicitly mention agents; otherwise, the default assistant decides whether to respond or dispatch work.

多 Agent 协作采用保守路由规则，避免 Agent 循环对话：人类消息可以显式 @Agent；无人 @ 时，由默认助理判断是否响应或分派任务。

---

## Development / 开发说明

Common commands:

常用命令：

```bash
# Type-check all packages / 类型检查
pnpm typecheck

# Build all packages / 构建
pnpm build

# Run project checks / 运行检查
pnpm check

# Clean build outputs / 清理构建产物
pnpm clean
```

The project uses a pnpm workspace. Shared types live in `packages/shared` and should be updated before changing backend/frontend event contracts.

项目使用 pnpm workspace。共享类型位于 `packages/shared`，修改前后端事件协议时应先同步共享类型。

---

## Design Docs / 设计文档

Detailed design documents are kept under `docs/design/`:

详细设计文档位于 `docs/design/`：

- [System Overview / 系统设计总览](docs/design/DESIGN-OVERVIEW.md)
- [Original Requirements / 原始需求](docs/design/DESIGN.md)
- [Architecture / 技术架构](docs/design/ARCHITECTURE.md)
- [Agent System / Agent 体系](docs/design/DESIGN-AGENT.md)
- [Agent Runtime / Agent 运行时](docs/design/DESIGN-AGENT-RUNTIME.md)
- [Agent Collaboration / 多 Agent 协作](docs/design/DESIGN-AGENT-COLLABORATION.md)
- [Member Profiles / 成员角色系统](docs/design/DESIGN-MEMBER-PROFILES.md)
- [Long Tasks / 长任务机制](docs/design/DESIGN-LONG-TASKS.md)

---

## Roadmap / 路线图

Planned or ongoing work:

规划中或持续优化中：

- Agent marketplace and distribution flow / Agent 市场与分发流程
- Multi-agent collaboration UX / 多 Agent 协作前端体验
- Notification system / 消息通知系统
- Performance optimization for large rooms / 大房间性能优化
- PWA support / PWA 支持
- Production deployment guide / 生产部署文档

---

## License / 许可证

MIT
