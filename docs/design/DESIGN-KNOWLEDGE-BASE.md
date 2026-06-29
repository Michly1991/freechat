# FreeChat 知识库设计

## 当前口径：服务端统一维护，Agent 按需读取

FreeChat 知识库由 FreeChat Server 统一维护。Agent Client 不是知识库主存储，只在运行时通过连接器凭证按权限检索/读取，或在运行前同步必要规范文件。

Agent 在房间回答用户问题时，统一可读取三类知识：

1. **房间知识库**：当前房间/客户/项目内生效，适合保存项目背景、客户资料、已确认结论。
2. **Agent 专属知识库**：当前 Agent 的专业资料、方法论、角色知识。房间 clone/materialize 的 Agent 默认继承 root Agent 的知识。
3. **通用知识库**：全局公共知识、通用 SOP、产品规则等。

运行时优先级：房间知识 > Agent 专属知识 > 通用知识。若知识库内容与最近对话冲突，Agent 应先向用户确认。

## 数据来源

### `knowledge_entries`

保留三层 scope：

- `public`：通用知识库。
- `room`：房间知识库，绑定 `room_id`。
- `agent`：历史/兼容 Agent scope 知识，绑定 `agent_id`。

### `agent_knowledge_files`

Agent 专属知识文件正文与元数据。运行时读取时按 `rootAgentId = COALESCE(source_template_id, id)` 解析，使房间内 Agent 实例继承通讯录/root Agent 的知识库。

## 运行时统一检索

`knowledge-runtime.service.ts` 提供统一入口：

- `summary(roomId, agentId)`：返回当前 Agent 在当前房间可用知识源数量。
- `searchForAgent({ roomId, agentId, query, limit })`：统一检索房间、Agent、通用知识。
- `readForAgent({ roomId, agentId, ref })`：按引用读取正文。
- `getRuntimeContext(roomId, agentId, query)`：生成可注入模型 prompt 的精简知识上下文。

统一搜索结果包含：

```ts
{
  source: 'room' | 'agent' | 'agent-entry' | 'public',
  ref: 'room:<id>' | 'agent:<fileId>' | 'agent-entry:<id>' | 'public:<id>',
  title: string,
  excerpt: string,
  score: number,
  updatedAt: number
}
```

## Agent Runtime 行为

平台托管 Agent 在回复前会根据用户输入调用统一知识检索，并把命中摘要注入 prompt：

```text
【可参考知识库】
#1 [room] 项目背景 (room:xxx)
...
#2 [agent] 操作手册 (agent:xxx)
...
#3 [public] 通用规则 (public:xxx)
...
```

远程/客户端 Agent 通过 CLI 使用：

```bash
./freechat knowledge list
./freechat knowledge search "关键词"
./freechat knowledge read room:<entryId>
./freechat knowledge read agent:<fileId>
./freechat knowledge read public:<entryId>
```

CLI 会自动带当前 `roomId`，Agent 无需手动传房间参数。

## 远程 API

连接器接口：

- `GET /api/remote-agents/knowledge?roomId=<roomId>`
- `GET /api/remote-agents/knowledge/search?roomId=<roomId>&q=<query>&limit=8`
- `GET /api/remote-agents/knowledge/read?roomId=<roomId>&ref=<ref>`

兼容行为：不传 `roomId` 时保留旧的 Agent 专属知识 + public 读取路径。

## 权限边界

- 远程 Agent token 只能读取自己所在房间的 room 知识。服务端校验 `room_agents(roomId, agentId)`。
- Agent 专属知识只给当前 Agent 运行时读取；用户通过 UI/App Action 读取仍按 owner/admin/可使用权限校验。
- public 知识对登录用户/运行中 Agent 可读，写入仍由管理员控制。
- 小蜜代用户查知识时必须走 actorUserId 权限，不借小蜜身份越权。
- Client 本地不是知识库主存储，不应自动上传本地私人资料到服务端。
