# Agent 协同讨论设计

## 核心场景

多个 Agent 可以协同讨论复杂问题，由助理组织、汇总、拍板。

---

## 1. 讨论触发方式

### 用户主动发起
```
用户："大家讨论一下登录模块的技术方案"
助理判断：需要多 Agent 讨论
```

### 助理主动发起
```
用户："帮我设计一个完整的用户系统"
助理判断：这个需求复杂，涉及多个领域，需要讨论
助理："这是一个复杂需求，我组织相关专家讨论一下"
```

### 用户指定参与者
```
用户："@前端专家 @后端专家 你们聊聊这个方案"
```

---

## 2. 讨论流程

```
t0  用户/助理发起讨论

t1  助理宣布讨论开始：
    "📢 发起讨论：登录模块技术方案"
    "参与者：@前端专家 @安全专家 @后端专家"
    "@前端专家 请先说说前端方案？"

t2  前端专家（看到自己被@）：
    "从前端角度，建议用 React Hook Form + Zod..."

t3  安全专家：
    "安全建议：1. bcrypt 加密 2. CSRF Token..."

t4  后端专家：
    "后端可以用 JWT + Redis 做会话管理..."

t5  助理汇总：
    "📋 讨论总结：..."
    
    判断重要性：
    ├─ 常规方案 → 助理直接拍板，分配任务
    └─ 重要方案 → @用户 "请确认"

t6  用户确认（如果是重要方案）

t7  助理分配任务：
    "📋 任务1: 前端登录表单 → @前端专家"
    "📋 任务2: 后端认证接口 → @后端专家"
```

---

## 3. 助理如何判断"需要讨论"

助理读取 MEMBERS.md 了解成员能力，根据以下规则判断：

```markdown
## 判断规则

### 需要讨论的场景
- 需求涉及多个专业领域（前端 + 后端 + 安全...）
- 技术选型有多种方案，需要权衡
- 用户明确说"讨论一下"
- 影响范围大（架构变更、安全相关）

### 不需要讨论的场景
- 简单任务（改个样式、加个按钮）→ 直接做
- 单一领域（纯前端问题）→ 分配给对应专家
- 用户已经给出明确方案 → 直接执行

### 需要用户确认的场景（escalation）
- 架构变更
- 安全相关决策
- 产品方向选择
- 成本/时间影响大的方案
```

---

## 4. 讨论的前端展示

```
🤖 AI助理         14:30
────────────────────────────
📢 发起讨论：登录模块技术方案

参与者：@前端专家 @安全专家 @后端专家

@前端专家 请先说说前端方案？

🤖 前端专家       14:30
────────────────────────────
从前端角度，建议用 React Hook Form + Zod 做表单校验...
支持记住密码和自动填充...

🤖 安全专家       14:31
────────────────────────────
安全建议：
1. 密码必须 bcrypt 加密
2. 加 CSRF Token
3. 登录失败 5 次锁定 15 分钟

🤖 后端专家       14:31
────────────────────────────
后端可以用 JWT + Redis 做会话管理...
建议用 middleware 统一鉴权...

🤖 AI助理         14:32
────────────────────────────
📋 讨论总结：

方案：React Hook Form + Zod + bcrypt + CSRF + JWT + Redis
安全专家建议加登录锁定，后端建议用 middleware 鉴权。

⚠️ 这是重要技术方案，@张三 请确认是否按此方案执行？

👤 张三           14:33
────────────────────────────
确认

🤖 AI助理         14:33
────────────────────────────
好的，开始执行：
📋 任务1: 前端登录表单 → @前端专家
📋 任务2: 后端认证接口 → @后端专家
📋 任务3: 安全加固 → @安全专家
```

---

## 5. 讨论中的消息标记

为了前端能识别"这是一次讨论"，消息 payload 增加标记：

```typescript
// 讨论开始
{
  action: 'chat.send',
  payload: {
    content: '📢 发起讨论：登录模块技术方案',
    discussion_id: 'disc_abc123',  // 讨论 ID
    discussion_type: 'start'
  }
}

// 讨论中的消息
{
  action: 'chat.send',
  payload: {
    content: '从前端角度...',
    discussion_id: 'disc_abc123',  // 同一个讨论 ID
    discussion_type: 'participate'
  }
}

// 讨论总结
{
  action: 'chat.send',
  payload: {
    content: '📋 讨论总结：...',
    discussion_id: 'disc_abc123',
    discussion_type: 'summary',
    requires_approval: true  // 需要用户确认
  }
}
```

前端可以：
- 把同一讨论的消息视觉分组（加个背景色/边框）
- 显示"讨论中"的标识
- 总结消息高亮显示

---

## 6. 数据库设计

```sql
-- 讨论记录表
CREATE TABLE discussions (
  id TEXT PRIMARY KEY,           -- disc_xxx
  room_id TEXT NOT NULL,
  topic TEXT NOT NULL,           -- 讨论主题
  initiated_by TEXT NOT NULL,    -- 发起者（助理 or 用户）
  participants TEXT NOT NULL,    -- JSON: 参与者列表
  status TEXT NOT NULL DEFAULT 'ongoing',  -- ongoing | completed | cancelled
  summary TEXT,                  -- 讨论总结
  requires_approval BOOLEAN DEFAULT FALSE,
  approved_by TEXT,              -- 确认者
  approved_at INTEGER,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

-- 消息表增加讨论关联
ALTER TABLE messages ADD COLUMN discussion_id TEXT;
```

---

## 7. 助理的讨论组织能力

助理的 CLAUDE.md 中增加讨论指导：

```markdown
## 组织讨论

当需要多 Agent 讨论时：

1. **宣布讨论**
   send_message("📢 发起讨论：[主题]", { discussion_type: "start" })
   
2. **按顺序邀请发言**
   根据 MEMBERS.md 中的能力标签，按相关度排序邀请
   "@前端专家 请先说说前端方案？"
   "@安全专家 从安全角度评估一下？"
   
3. **汇总观点**
   等所有专家发言后，总结各方观点
   send_message("📋 讨论总结：...", { discussion_type: "summary" })
   
4. **判断是否需要用户确认**
   - 常规方案 → 直接拍板，分配任务
   - 重要方案 → @用户 确认
   判断依据：MEMBERS.md 中成员的 escalation_level
   
5. **分配任务**
   根据讨论结果，创建任务并分配给对应专家
```

---

## 8. 讨论的限制

- **并发讨论**：同一房间同时只能有一个讨论
- **参与者上限**：最多 5 个 Agent 参与讨论
- **超时**：如果某个 Agent 30 秒没回复，跳过它继续
- **循环检测**：如果讨论陷入循环（观点重复），助理主动拍板

---

## 9. 讨论 vs 直接执行

| 场景 | 处理方式 |
|------|---------|
| "改个按钮颜色" | 直接执行，不讨论 |
| "设计登录模块" | 组织讨论，多专家参与 |
| "@前端专家 这个怎么做" | 直接问前端专家，不讨论 |
| "大家觉得哪个方案好" | 组织讨论，收集意见 |
| 架构变更 | 必须讨论 + 用户确认 |
| 简单 bug 修复 | 直接执行 |
