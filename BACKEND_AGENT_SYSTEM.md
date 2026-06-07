# Backend Agent System - Implementation Complete

# AI 模型配置

使用阿里云百炼的 Anthropic 兼容接口调用通义千问 qwen3.7-max 模型：

**环境变量** (`packages/server/.env`)：
```bash
ANTHROPIC_API_KEY=你的阿里云百炼API_Key
ANTHROPIC_BASE_URL=https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic
ANTHROPIC_MODEL=qwen3.7-max
```

**Claude Code CLI 配置** (`~/.claude/settings.json`)：
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
    "ANTHROPIC_API_KEY": "你的阿里云百炼API_Key",
    "ANTHROPIC_MODEL": "qwen3.7-max"
  }
}
```

**重要说明**：
- 模型名称必须是 `qwen3.7-max`，不是 Claude 系列
- API Key 从阿里云百炼控制台获取
- 使用 Anthropic 兼容接口协议

**测试配置**：
```bash
claude -p "你好" --model qwen3.7-max
```

## Overview
Complete backend implementation for the FreeChat Agent system with Claude Code CLI integration, member profiles, and MCP tool support.

## Files Created/Modified

### 1. Database Schema (`src/storage/db.ts`)
**Added tables:**
- `room_profiles` - Store custom profiles for room members (humans and agents)
  - Fields: room_id, member_id, member_type, display_name, role_description, avatar, custom_data
- `agent_sessions` - Track Claude Code sessions per agent per room
  - Fields: room_id, agent_id, session_id, message_count, created_at, last_active_at
- `room_agents` - Junction table linking agents to rooms
  - Fields: room_id, agent_id, added_by, added_at

**Modified tables:**
- `agents` - Added `owner_id` and `api_key_hash` fields for ownership and API key management

### 2. Agent Service (`src/services/agent.service.ts`)
**Core functionality:**
- **Agent CRUD**: Create, read, update, delete agents with ownership tracking
- **API Key Management**: 
  - Generate secure API keys: `fc_${crypto.randomBytes(32).toString('hex')}`
  - Store bcrypt hashes, return plaintext only once at creation
  - Regenerate keys on demand
  - Validate API keys for authentication
- **Room Management**: Add/remove agents to/from rooms
- **Claude Code Integration**:
  - `spawnClaudeCode(roomId, agentId, message)` - Execute Claude CLI
  - Manage session IDs for conversation continuity (`--resume` flag)
  - Handle `[SILENT]` marker when agent chooses not to reply
  - 2-minute timeout, captures stdout as response
  - Automatic session tracking in `agent_sessions` table
- **Marketplace**: Hardcoded list of 5 featured agents (Code Reviewer, Tech Writer, Task Master, Research Assistant, Debugger)

### 3. Members Service (`src/services/members.service.ts`)
**Profile management:**
- Get/set/update room profiles for members
- Batch update profiles (room owners only)
- **MEMBERS.md generation**: 
  - Automatically generates `.freechat/MEMBERS.md` in workspace
  - Lists humans with display names, usernames, and roles
  - Lists agents with descriptions
  - Updates on profile changes

### 4. Agent Routes (`src/routes/agents.ts`)
**User's own agents:**
- `GET /api/agents` - List user's agents
- `POST /api/agents` - Create agent (returns api_key once)
- `PATCH /api/agents/:id` - Update agent (ownership verified)
- `DELETE /api/agents/:id` - Delete agent (ownership verified)
- `POST /api/agents/:id/regenerate-key` - Regenerate API key (ownership verified)

**Room agents:**
- `GET /api/rooms/:roomId/agents` - List agents in room
- `POST /api/rooms/:roomId/agents` - Add agent to room
- `DELETE /api/rooms/:roomId/agents/:agentId` - Remove agent from room
- `POST /api/rooms/:roomId/agents/:agentId/invoke` - Invoke agent with message
  - Spawns Claude Code CLI
  - Posts agent response as message in room
  - Handles [SILENT] responses
  - Updates agent status (working → active)

**Marketplace:**
- `GET /api/agent-market/search?q=xxx` - Search marketplace
- `GET /api/agent-market/featured` - Get featured agents

### 5. Profile Routes (`src/routes/profiles.ts`)
- `GET /api/rooms/:roomId/profiles` - Get all profiles in room
- `PUT /api/rooms/:roomId/profiles/:memberId` - Set/update profile (self or owner)
- `POST /api/rooms/:roomId/profiles/batch` - Batch update profiles (owner only)
- `GET /api/users/:userId` - Get user info
- `GET /api/users/search?q=xxx` - Search users by username/nickname

### 6. MCP Server (`src/mcp/index.ts`)
**Standalone stdio-based MCP server for Claude Code integration:**
- Implements MCP protocol (JSON-RPC 2.0 over stdio)
- Environment variables:
  - `FREECHAT_ROOM_ID` - Current room ID
  - `FREECHAT_API_URL` - API base URL (default: http://localhost:3000)
  - `FREECHAT_API_KEY` - Agent API key for authentication

**Tools exposed:**
1. `send_message(content)` - Send message to room
2. `create_task(title, description?, priority?, assignee?)` - Create task
3. `update_task(task_id, updates)` - Update task
4. `list_tasks(status?)` - List tasks with optional status filter
5. `list_members()` - List room members
6. `get_room_info()` - Get room information

### 7. App Registration (`src/app.ts`)
Registered new route modules:
- `registerAgentRoutes(app)`
- `registerProfileRoutes(app)`

## Key Features

### Security
- API keys generated with `crypto.randomBytes(32)` and stored as bcrypt hashes
- Ownership verification for agent operations
- Room membership checks for all room-scoped operations
- Profile update permissions (self or room owner)

### Claude Code Integration
- Session management for conversation continuity
- `[SILENT]` marker support for agent-chosen silence
- Automatic session tracking and message counting
- Workspace directory isolation per room
- 2-minute execution timeout

### Member Profiles
- Custom display names and role descriptions per room
- Avatars and custom data storage
- Automatic MEMBERS.md generation for agent context
- Batch operations for room owners

## Usage Example

### 1. Create an Agent
```bash
POST /api/agents
{
  "name": "Code Assistant",
  "roleType": "assistant",
  "deployment": "server",
  "description": "Helps with code reviews and debugging"
}
# Returns: { agent: {...}, apiKey: "fc_abc123..." }
```

### 2. Add Agent to Room
```bash
POST /api/rooms/room_xxx/agents
{
  "agentId": "agent_yyy"
}
```

### 3. Invoke Agent
```bash
POST /api/rooms/room_xxx/agents/agent_yyy/invoke
{
  "message": "Review this code for security issues"
}
# Agent spawns Claude Code, processes message, posts response
```

### 4. Update Profile
```bash
PUT /api/rooms/room_xxx/profiles/usr_zzz
{
  "displayName": "Lead Developer",
  "roleDescription": "Backend architecture and code review"
}
# Automatically updates .freechat/MEMBERS.md
```

## Compilation Status
✅ All new files compile without TypeScript errors
⚠️  4 pre-existing errors in `app.ts` (error handler) and `jwt.ts` (token signing) - not related to this implementation

## Next Steps
1. Add API key authentication middleware for agent endpoints
2. Implement WebSocket events for agent status updates
3. Add rate limiting for agent invocations
4. Create admin panel for marketplace management
5. Add agent usage analytics and billing
