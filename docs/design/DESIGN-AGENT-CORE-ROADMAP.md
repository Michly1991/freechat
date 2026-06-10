# DESIGN AGENT CORE ROADMAP

> 从 DESIGN-AGENT.md 拆分出的前端展示、REST API、开发阶段和待确定事项。


```
┌──────────────────────────┐
│ 成员 (4)                 │
│ 🤖 AI助理 (常驻)         │  ← 始终在线
│ 👤 张三 (owner)          │
│ 🤖 代码Agent (工作中...) │  ← 临时专业 Agent
│ 👤 李四 (editor)         │
└──────────────────────────┘
```

### Agent 工作流可视化

```
🤖 AI助理           14:30
──────────────────────────
好的，我来安排这个需求：
📋 任务1: 开发登录页面 → 代码Agent
📋 任务2: 编写测试 → 测试Agent

🤖 代码Agent        14:30
──────────────────────────
⚙️ 收到，我来开发登录页面
   正在分析需求...

🤖 代码Agent        14:33
──────────────────────────
✅ 登录页面开发完成
  - files/src/login.tsx
  - files/src/login.css
  可在"面板" Tab 预览

🤖 AI助理           14:35
──────────────────────────
✅ 全部完成！
  - 开发 ✅ 代码Agent
  - 测试 ✅ 测试Agent (12/12 pass)
```

---

## 8. REST API（简化）

```typescript
// 获取房间的 Agent 列表
GET /api/rooms/:id/agents
Response: { 
  assistant: { name, status, system_prompt },
  specialists: [{ name, status, task, system_prompt }]
}

// 修改助理的 system prompt（用户自定义助理性格/能力）
PATCH /api/rooms/:id/assistant
Body: { system_prompt?: string }
Response: { success: true }

// 手动启动一个专业 Agent（用户主动要求）
POST /api/rooms/:id/agents
Body: { name: string, system_prompt: string, task: string }
Response: { agent_id: string }

// 停止一个专业 Agent
DELETE /api/rooms/:id/agents/:agentId
Response: { success: true }
```

---

## 9. 开发阶段

### Phase 1（MVP）
- [ ] 房间创建时自动启动助理 Claude Code
- [ ] 助理监听消息 → 直接回答简单问题
- [ ] 助理创建任务 → 任务在聊天和看板同步展示
- [ ] MCP Tools：send_message, create_task, update_task

### Phase 2
- [ ] 助理动态启动专业 Claude Code
- [ ] 专业 Agent 执行任务 → 输出实时广播
- [ ] 专业 Agent 完成任务自动退出

### Phase 3
- [ ] 用户自定义助理 prompt
- [ ] Agent 工作流可视化
- [ ] 专业 Agent 模板（代码/测试/文档等预设角色）

### Phase 4
- [ ] Agent 主动行为（定时汇报、异常检测）
- [ ] Agent 记忆（跨会话上下文持久化）
- [ ] 多 Agent 并行工作

---

## 10. 待确定

1. **Claude Code 的启动方式**：CLI（`claude --cwd ...`）？SDK？Subprocess？
2. **Claude Code 的会话管理**：常驻进程怎么保持上下文？用 `--resume` 还是始终保持 stdin 管道？
3. **并发控制**：多个专业 Agent 同时写同一个文件怎么办？（建议：助理在分配任务时避免文件冲突）

---

## 实现细节拆分

为控制单文件体积，当前实现补充已拆到专题文档：

- [DESIGN-AGENT-RUNTIME.md](./DESIGN-AGENT-RUNTIME.md)：Claude Code 运行时、Agent 工作区、CLI、Tab API、资源保护。
- [DESIGN-AGENT-COLLABORATION.md](./DESIGN-AGENT-COLLABORATION.md)：业务自定义 Agent、多 Agent 协作、任务计划、依赖、权限与确认规则。
