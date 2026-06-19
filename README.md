# FreeChat - AI Collaborative Workspace / AI 协同办公空间

FreeChat is an AI-native collaborative workspace where humans and agents work in the same project rooms, share tasks and files, use the same real-time protocol, and coordinate work through both chat and structured workflows.

FreeChat 是一个 AI 原生协同办公空间：人类和 Agent 在同一个项目房间中协作，共享任务、文件和上下文，通过聊天与结构化流程共同完成工作。

> Status: active development. The current version is best suited for local/private deployment, product validation, and human-agent collaboration experiments.
>
> 状态：持续开发中。当前版本适合本地/私有化部署、产品验证和人机协作实验。

---

## Why FreeChat / 为什么做 FreeChat

Most collaboration tools were designed for humans first, then added AI as a side chat box. FreeChat takes a different approach: agents are first-class collaborators. They can join rooms, read context, receive tasks, operate files, create pages, report progress, and leave observable execution records.

大多数协作工具先为人类设计，再把 AI 当作侧边聊天框接入。FreeChat 的方向不同：Agent 是一等协作者。它们可以进入项目房间、读取上下文、接收任务、操作文件、创建页面、汇报进度，并留下可观测的执行记录。

The goal is to build a lightweight operating space for future human-agent teams.

目标是打造一个轻量级的人机协作操作空间。

---

## What FreeChat Provides / FreeChat 当前能力

### 1. Project Rooms / 项目房间

- Real-time room chat powered by WebSocket.
- Room members, permissions, invite links, and logical room deletion.
- Per-room isolated workspace for files, pages, tasks, and agent artifacts.
- 基于 WebSocket 的实时房间聊天。
- 房间成员、权限、邀请链接和逻辑删除。
- 每个房间独立的文件、页面、任务和 Agent 产物工作区。

### 2. Messaging, Friends, and DM / 消息、好友和单聊

- Home conversation list that mixes project rooms and direct messages.
- Friend search, friend requests, accept/reject flow, and friend list.
- One-to-one DM conversations with unread counts and recent-message previews.
- Conversation preferences: pinned, muted, hidden, and read state.

- 首页会话列表同时展示项目房间和单聊。
- 支持搜索用户、发送好友申请、接受/拒绝申请和好友列表。
- 支持一对一单聊、未读数和最近消息预览。
- 支持会话置顶、免打扰、隐藏和已读状态。

### 3. Tasks and Long Workflows / 任务和长任务

- Task board with statuses: `todo`, `assigned`, `doing`, `review`, `blocked`, `done`, `failed`, `cancelled`.
- Parent tasks, subtasks, dependencies, assignees, retry flow, and review flow.
- Human and agent assignees use the same task model.
- Long AI work can be split into a parent task plus serial subtasks, with artifacts written back to project files.

- 任务看板支持 `todo`、`assigned`、`doing`、`review`、`blocked`、`done`、`failed`、`cancelled` 状态。
- 支持父任务、子任务、依赖、负责人、失败重试和审核流程。
- 人类和 Agent 使用同一套任务模型。
- 长 AI 工作可以拆成父任务和串行子任务，产物回写到项目文件。

### 4. Files and Dynamic Pages / 文件和动态页面

- Project file tree, upload, create folder, create/edit/delete files.
- File mentions in chat context.
- Dynamic HTML tabs/pages rendered in a sandboxed iframe.
- 支持项目文件树、上传、创建文件夹、创建/编辑/删除文件。
- 聊天中支持引用文件作为上下文。
- 支持动态 HTML 页签/页面，并通过沙箱 iframe 渲染。

### 5. Agent Collaboration / Agent 协作

- Built-in default assistant for every room.
- Custom assistant/specialist agents with prompts, tools, skills, and scripts.
- Agent package upload and import flow.
- Agent skills/scripts CRUD and per-agent runtime configuration.
- Conservative multi-agent routing to avoid noisy agent loops.
- 每个房间都有内置默认助理。
- 支持自定义助理/专家 Agent，配置提示词、工具、Skill 和脚本。
- 支持 Agent 包上传和导入。
- 支持 Agent Skill/Script 增删改查和运行时配置。
- 多 Agent 路由采用保守策略，避免 Agent 循环对话。

### 6. Marketplace / 市场

FreeChat has marketplace surfaces for three resource types:

FreeChat 目前有三类市场资源：

- **Agents / Agent**: discover, follow, clone into rooms, and publish agent templates.
- **Model services / 模型服务**: publish or follow model providers without exposing API keys to consumers.
- **Scenes / 场景**: reusable project templates with agents, pages, and billing rules.

- **Agent**：发现、关注、克隆到房间，以及发布 Agent 模板。
- **模型服务**：发布或关注模型服务，消费者不可见完整 API Key。
- **场景**：可复用的项目模板，包含 Agent、页面和计费规则。

### 7. Billing and Model Providers / 账单与模型服务

- Credit wallet and ledger.
- Model profiles with encrypted API keys and visibility control.
- Room-agent model binding: model profile, model name, runtime, max tokens, temperature.
- Model, agent, and scene billing rules.
- Usage metering from agent runs and billing aggregation by project, agent, model, scene purchase, and day.

- 支持积分钱包和账本。
- 支持模型配置，API Key 加密保存，并有可见性控制。
- 支持房间 Agent 绑定模型配置、模型名、运行方式、max tokens、temperature。
- 支持模型、Agent、场景计费规则。
- 从 Agent 执行记录中采集用量，并按项目、Agent、模型、场景购买和日期聚合账单。

### 8. Notifications and Analytics / 通知和分析

- In-app notification panel and unread badge.
- Mention/task/agent-related notifications.
- Room analytics and personal analytics for agent runs, costs, and execution history.

- 内置通知面板和未读角标。
- 支持 @提及、任务、Agent 相关通知。
- 支持房间分析和个人分析，用于查看 Agent 执行、成本和历史。

---

## Product UI / 产品界面结构

Current main surfaces:

当前主要界面：

- **Home / 首页**: Messages, Contacts, Market, Billing, Settings.
- **Room / 房间**: Chat, Files, Pages/Tabs, Tasks, Members, Agent management, Settings.
- **DM / 单聊**: one-to-one chat with friends.
- **Settings / 设置**: profile, model services, billing, and personal configuration.

Mobile layout uses bottom navigation and drawer-style panels where appropriate.

移动端采用底部导航和抽屉面板适配。

---

## Tech Stack / 技术栈

### Backend / 后端

- Node.js 20+
- Fastify 5
- WebSocket / `ws`
- SQLite / `better-sqlite3`
- JWT authentication
- Multipart upload and static uploads
- TypeScript

### Frontend / 前端

- React 18
- Vite 5
- Zustand
- Tailwind CSS
- React Router
- TypeScript

### Agent Runtime / Agent 运行时

- Claude Code CLI compatible runtime by default.
- Optional Anthropic-compatible provider API runtime.
- Per-agent private workspace.
- Agent Tool API / generated `./freechat` CLI.
- Streaming agent activity and persisted agent runs.

- 默认使用 Claude Code CLI 兼容运行时。
- 可选 Anthropic 兼容 Provider API 运行时。
- 每个 Agent 拥有私有工作区。
- 通过 Agent Tool API / 生成的 `./freechat` CLI 操作系统能力。
- 支持 Agent 流式活动和持久化执行记录。

---

## Architecture / 架构概览

```text
freechat/
├── packages/
│   ├── shared/       # Shared TypeScript types and constants / 共享类型和常量
│   ├── server/       # Fastify backend, WebSocket gateway, SQLite / 后端服务
│   └── web/          # React frontend / 前端应用
├── docs/design/      # System design documents / 系统设计文档
└── .freechat/        # Local runtime data, ignored by git / 本地运行时数据
```

High-level flow:

整体流程：

```text
Browser / 浏览器
  ↓ HTTP + WebSocket
FreeChat Server / FreeChat 后端
  ↓ SQLite + workspace files
Rooms, messages, tasks, files, tabs / 房间、消息、任务、文件、页面
  ↓ Agent invocation
Agent runtime / Agent 运行时
  ↓ model/tool calls
AI model + FreeChat tools / AI 模型与 FreeChat 工具
```

Key backend domains:

关键后端领域：

- Auth, users, profiles
- Rooms, members, messages, tasks
- Friends, DM, conversations
- Files, uploads, tabs, tab config
- Agents, skills, scripts, packages, scenes
- Marketplace, follows, purchases
- Model profiles, billing rules, wallets, ledger, usage metering
- Notifications, room analytics, personal analytics
- Agent dreams, agent growth, agent run recovery

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

# Local data paths / 本地数据路径
DB_PATH=.freechat/data/freechat.db
UPLOAD_DIR=.freechat/data/uploads
WORKSPACE_ROOT=.freechat/workspace-data

# Agent runtime / Agent 运行时
AGENT_RUNTIME=claude-code
AGENT_CHAT_TIMEOUT_MS=180000
AGENT_TASK_TIMEOUT_MS=600000
AGENT_HARD_TIMEOUT_MS=900000

# Optional legacy/default model config / 可选默认模型配置
ANTHROPIC_API_KEY=***
ANTHROPIC_BASE_URL=https://your-anthropic-compatible-endpoint
ANTHROPIC_MODEL=qwen3.7-max
```

Most model configuration can also be managed inside the app through model profiles and room-agent model bindings.

多数模型配置也可以在应用内通过模型服务和房间 Agent 模型绑定管理。

### 3. Configure Claude Code CLI / 配置 Claude Code CLI

If you use the default `claude-code` runtime, create or update `~/.claude/settings.json`:

如果使用默认 `claude-code` 运行时，创建或更新 `~/.claude/settings.json`：

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

## Development / 开发说明

Common commands:

常用命令：

```bash
# Start all workspace dev scripts / 启动所有 workspace dev 脚本
pnpm dev

# Type-check all packages / 类型检查
pnpm typecheck

# Build all packages / 构建
pnpm build

# Run project checks / 运行检查
pnpm check

# File size guard / 文件大小检查
pnpm check:size

# Clean build outputs / 清理构建产物
pnpm clean
```

The project uses a pnpm workspace. Shared contracts live in `packages/shared`; update shared types before changing backend/frontend message, task, agent, or WebSocket contracts.

项目使用 pnpm workspace。共享协议位于 `packages/shared`；修改前后端消息、任务、Agent 或 WebSocket 协议前，应先更新共享类型。

---

## Design Docs / 设计文档

Detailed design documents are kept under `docs/design/`:

详细设计文档位于 `docs/design/`：

- [System Overview / 系统设计总览](docs/design/DESIGN-OVERVIEW.md)
- [Original Requirements / 原始需求](docs/design/DESIGN.md)
- [Architecture / 技术架构](docs/design/ARCHITECTURE.md)
- [Frontend Architecture / 前端架构](docs/design/ARCHITECTURE-FRONTEND.md)
- [Data Architecture / 数据架构](docs/design/ARCHITECTURE-DATA.md)
- [Agent System / Agent 体系](docs/design/DESIGN-AGENT.md)
- [Agent Runtime / Agent 运行时](docs/design/DESIGN-AGENT-RUNTIME.md)
- [Remote Agent Connector / 远程 Agent 连接器](docs/design/DESIGN-REMOTE-AGENT-CONNECTOR.md)
- [Agent Streaming / Agent 流式事件](docs/design/DESIGN-AGENT-STREAMING.md)
- [Agent Collaboration / 多 Agent 协作](docs/design/DESIGN-AGENT-COLLABORATION.md)
- [Agent Package Publishing / Agent 包发布](docs/design/DESIGN-AGENT-PACKAGE-PUBLISHING.md)
- [Marketplace / 市场](docs/design/DESIGN-MARKETPLACE.md)
- [Billing and Model Providers / 账单与模型服务](docs/design/DESIGN-BILLING-AND-MODEL-PROVIDERS.md)
- [Friends and DM / 好友与单聊](docs/design/DESIGN-FRIENDS-DM.md)
- [Conversations / 会话](docs/design/DESIGN-CONVERSATIONS.md)
- [Notifications and Interactions / 通知与交互](docs/design/DESIGN-INTERACTION-NOTES.md)
- [Room Analytics / 房间分析](docs/design/DESIGN-ROOM-ANALYTICS.md)
- [Personal Analytics / 个人分析](docs/design/DESIGN-PERSONAL-ANALYTICS.md)
- [Long Tasks / 长任务机制](docs/design/DESIGN-LONG-TASKS.md)
- [Scene Templates / 场景模板](docs/design/DESIGN-SCENE-TEMPLATES.md)

---

## Roadmap / 路线图

Ongoing work:

持续优化方向：

- More complete production deployment guide.
- Stronger marketplace packaging and review workflow.
- More polished multi-agent and remote Agent collaboration UX.
- More deployment diagnostics for remote Claude Code agents.
- Better notification preferences and possible PWA push support.
- Performance optimization for large rooms, long histories, and heavy agent activity.
- More complete billing audits and model-provider settlement flows.

- 更完整的生产部署文档。
- 更完善的市场打包、发布和审核流程。
- 更顺滑的多 Agent 协作体验。
- 更细的通知偏好，以及未来可能的 PWA 推送。
- 大房间、长历史和高频 Agent 活动下的性能优化。
- 更完整的账单审计和模型服务商结算流程。

---

## License / 许可证

MIT
