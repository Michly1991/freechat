# 成员角色系统设计

## 核心设计

每个房间的每个成员（人 + Agent）都有角色档案，存储在 `.freechat/MEMBERS.md` 文件中。

**解耦设计**：服务端维护数据库，成员变动时自动更新 MEMBERS.md 文件，Agent 按需读取文件了解房间成员。

---

## 1. 角色档案结构

### MEMBERS.md 文件格式

```markdown
# 房间成员档案

最后更新：2024-06-07 11:30

## 人类成员

### 张三
- **身份**：产品经理
- **人设**：注重用户体验，决策果断，喜欢简洁方案
- **能力**：需求分析、产品设计、项目管理
- **权限**：重要方案需要确认（escalation_level: 10）

### 李四
- **身份**：技术负责人
- **人设**：追求代码质量，偏好简洁方案
- **能力**：架构设计、后端开发、性能优化
- **权限**：技术方案需审核（escalation_level: 7）

## Agent 成员

### AI助理
- **身份**：项目管家
- **人设**：高效协调，善于总结，推动进度
- **能力**：任务拆解、进度跟踪、方案汇总
- **状态**：在线

### 前端专家
- **身份**：前端开发
- **人设**：注重交互细节，熟悉 React 生态
- **能力**：React、CSS、动画、响应式
- **状态**：在线

### 安全专家
- **身份**：安全顾问
- **人设**：谨慎严谨，零容忍安全漏洞
- **能力**：安全审计、加密方案、权限控制
- **状态**：在线
```

---

## 2. 数据库设计

```sql
-- 成员角色档案表（房间级别）
CREATE TABLE room_profiles (
  room_id TEXT NOT NULL,
  member_id TEXT NOT NULL,         -- user_id 或 agent_id
  member_type TEXT NOT NULL,       -- human | agent
  role_title TEXT NOT NULL,        -- "产品经理" / "前端开发"
  persona TEXT,                    -- 人设描述
  specialties TEXT NOT NULL DEFAULT '[]',  -- JSON 数组 ["React", "CSS"]
  can_approve TEXT NOT NULL DEFAULT '[]',  -- 能审批的领域 ["前端方案"]
  escalation_level INTEGER DEFAULT 5,      -- 重要程度阈值（1-10）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, member_id)
);
```

### escalation_level 说明

| 级别 | 含义 | 示例角色 |
|------|------|---------|
| 1-3 | 常规事务，助理自主决策 | AI助理 |
| 4-6 | 中等重要，专家可决策 | 前端专家、测试专家 |
| 7-8 | 重要方案，技术负责人确认 | 技术负责人 |
| 9-10 | 关键决策，产品负责人确认 | 产品经理、项目 owner |

---

## 3. 服务端维护机制

### 文件生成时机

```typescript
// 以下事件触发 MEMBERS.md 更新：

// 1. 成员加入/退出房间
onMemberJoin(roomId, userId) → updateMembersFile(roomId)
onMemberLeave(roomId, userId) → updateMembersFile(roomId)

// 2. 成员角色/能力修改
onProfileUpdate(roomId, userId, profile) → updateMembersFile(roomId)

// 3. Agent 添加/移除
onAgentAdded(roomId, agentId) → updateMembersFile(roomId)
onAgentRemoved(roomId, agentId) → updateMembersFile(roomId)

// 4. 房间创建（初始化）
onRoomCreated(roomId) → updateMembersFile(roomId)
```

### 文件生成逻辑

```typescript
async function updateMembersFile(roomId: string) {
  const members = await db.query(`
    SELECT rp.*, rm.role as room_role
    FROM room_profiles rp
    JOIN room_members rm ON rp.member_id = rm.user_id AND rp.room_id = rm.room_id
    WHERE rp.room_id = ?
  `, [roomId]);
  
  const agents = await db.query(`
    SELECT a.*, ra.status
    FROM agents a
    JOIN room_agents ra ON a.id = ra.agent_id
    WHERE ra.room_id = ?
  `, [roomId]);
  
  const content = generateMembersMarkdown(members, agents);
  
  // 原子写入
  const tmpPath = `/workspace-data/${roomId}/.freechat/MEMBERS.md.tmp`;
  const finalPath = `/workspace-data/${roomId}/.freechat/MEMBERS.md`;
  
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, finalPath);
}
```

---

## 4. REST API

### 角色档案 CRUD

```typescript
// 获取成员角色档案
GET /api/rooms/:roomId/profiles
Response: {
  profiles: [{
    member_id: string,
    member_type: 'human' | 'agent',
    role_title: string,
    persona: string,
    specialties: string[],
    can_approve: string[],
    escalation_level: number
  }]
}

// 设置/更新成员角色
PUT /api/rooms/:roomId/profiles/:memberId
Body: {
  role_title: string,        // "产品经理"
  persona?: string,          // "注重用户体验，决策果断"
  specialties?: string[],    // ["需求分析", "产品设计"]
  can_approve?: string[],    // ["产品方案", "UI变更"]
  escalation_level?: number  // 1-10
}
Response: { success: true }
// 触发 MEMBERS.md 更新

// 批量设置角色（房间设置页）
POST /api/rooms/:roomId/profiles/batch
Body: {
  profiles: [{
    member_id: string,
    role_title: string,
    persona?: string,
    specialties?: string[],
    can_approve?: string[],
    escalation_level?: number
  }]
}
Response: { success: true }
```

### 用户信息查询

```typescript
// 查询单个用户信息（全局）
GET /api/users/:userId
Response: {
  id: string,
  username: string,
  nickname: string,
  avatar: string,
  created_at: number
}

// 搜索用户（用于邀请、@提及）
GET /api/users/search?q=张三&limit=20&pageToken=0
Response: {
  users: [{ id, username, nickname, avatar }],
  hasMore: boolean,
  nextPageToken: string | null
}
```

---

## 5. 前端界面

### 房间设置 - 成员角色管理

```
┌──────────────────────────────────┐
│  ← 返回       成员角色设置       │
├──────────────────────────────────┤
│                                  │
│ 👤 张三 (owner)                  │
│   身份：[产品经理________]        │
│   人设：[注重用户体验，决策果断__] │
│   能力：[需求分析] [产品设计] [+]  │
│   审批权限：[产品方案] [UI变更] [+]│
│   重要程度：[████████░░] 10      │
│                                  │
│ 🤖 前端专家 (agent)              │
│   身份：[前端开发________]        │
│   人设：[注重交互细节____________] │
│   能力：[React] [CSS] [+]        │
│                                  │
│ 🤖 安全专家 (agent)              │
│   身份：[安全顾问________]        │
│   人设：[谨慎严谨_______________] │
│   能力：[安全审计] [+]            │
│                                  │
│ [保存修改]                       │
│                                  │
└──────────────────────────────────┘
```

移动端：每个成员一个卡片，点击展开编辑。

---

## 6. Agent 如何使用 MEMBERS.md

### 助理判断流程

```
收到消息 → 判断需要行动
    ↓
读取 .freechat/MEMBERS.md
    ↓
分析：
  - 谁擅长这个？→ specialties 匹配
  - 谁能审批？→ can_approve 匹配
  - 重要程度？→ escalation_level 判断是否需要人类确认
    ↓
决策：
  - 有对应专家 → 创建任务分配给它
  - 没有专家 → 自己做
  - 重要方案 → @对应 escalation_level 高的人确认
```

### CLAUDE.md 中的指导

```markdown
## 了解团队成员

当需要了解谁适合做什么时，读取 .freechat/MEMBERS.md。

根据成员信息决策：
- 分配任务：找 specialties 匹配的成员
- 需要确认：找 escalation_level >= 7 的成员
- 组织讨论：找所有相关 specialties 的成员
```

---

## 7. 默认角色

### 新成员加入时

```typescript
// 人类成员默认角色
{
  role_title: '成员',
  persona: '',
  specialties: [],
  can_approve: [],
  escalation_level: 5
}

// 房间 owner 默认角色
{
  role_title: '项目负责人',
  persona: '',
  specialties: [],
  can_approve: ['所有方案'],
  escalation_level: 10
}

// 助理 Agent 默认角色
{
  role_title: '项目管家',
  persona: '高效协调，善于总结，推动进度',
  specialties: ['任务拆解', '进度跟踪', '方案汇总'],
  can_approve: [],
  escalation_level: 3
}

// 专家 Agent 默认角色（从 Agent 定义中读取）
{
  role_title: agent.name,        // 如"前端专家"
  persona: agent.description,    // Agent 描述
  specialties: agent.specialties, // Agent 能力标签
  can_approve: [],
  escalation_level: 5
}
```

---

## 8. 数据流向

```
用户在前端修改角色
    ↓
POST /api/rooms/:roomId/profiles/:memberId
    ↓
服务端写入 room_profiles 表
    ↓
触发 updateMembersFile(roomId)
    ↓
读取 room_profiles + agents 数据
    ↓
生成 MEMBERS.md 内容
    ↓
原子写入 .freechat/MEMBERS.md
    ↓
Agent 下次需要时读取文件
```

**关键点**：Agent 不直接调 API 获取成员信息，而是读文件。这样：
- 解耦：Agent 不依赖 API 可用性
- 缓存：文件就是缓存，不用每次查询
- 透明：用户可以直接查看/编辑 MEMBERS.md
- 高效：成员变动不频繁，文件更新成本低

## 成员交互优化（2026-06-08）

项目对话页成员入口与悬浮交互调整：

- 移动端不再使用左下角悬浮“成员”按钮，改为房间顶部右侧成员入口，显示成员 + Agent 总数，避免遮挡聊天内容。
- 移动端成员列表采用底部抽屉：标题为“成员与 AI”，分组展示“在线成员”和“AI Agents”，高度上限 75vh，内容可滚动。
- 桌面端成员面板保持左侧栏，但折叠/展开按钮使用 `PanelLeftClose` / `PanelLeftOpen` 图标，降低突兀感。
- 成员列表和 Agent 列表均可点击，打开统一的成员信息卡片。
- 聊天消息头像/发送者名称可点击，打开成员/Agent 信息卡片。
- 信息卡片手机端从底部弹出，桌面端居中显示，展示名称、用户名/角色、状态、Agent 类型和专长。
