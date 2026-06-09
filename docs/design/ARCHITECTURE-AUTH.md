# FreeChat 认证与用户系统架构

> 从 ARCHITECTURE 拆分出的认证、Agent 认证和前端/部署细节索引。

## 认证与用户系统

### REST API 端点

```typescript
// ─── 认证 ────────────────────────────────

// 注册
POST /api/auth/register
Body: { username: string, password: string, nickname: string }
Response: { user: { id, username, nickname, avatar }, token: string }

// 登录
POST /api/auth/login
Body: { username: string, password: string }
Response: { user: { id, username, nickname, avatar }, token: string }

// 刷新 Token
POST /api/auth/refresh
Header: Authorization: Bearer <token>
Response: { token: string }

// 获取当前用户信息
GET /api/auth/me
Header: Authorization: Bearer <token>
Response: { id, username, nickname, avatar, role, created_at }

// 更新个人设置
PATCH /api/user/profile
Header: Authorization: Bearer <token>
Body: { nickname?: string, avatar?: string }
Response: { user: { id, username, nickname, avatar } }

// 修改密码
POST /api/user/password
Header: Authorization: Bearer <token>
Body: { old_password: string, new_password: string }
Response: { success: true }

// 上传头像
POST /api/user/avatar
Header: Authorization: Bearer <token>
Content-Type: multipart/form-data
Body: file (image/*, max 2MB)
Response: { avatar_url: string }

// ─── 项目 ────────────────────────────────

// 获取我的项目列表（首页用，按 last_active_at 降序）
GET /api/rooms
Header: Authorization: Bearer <token>
Response: { rooms: [{ id, name, description, member_count, online_count, last_active_at, created_at }] }

// 创建项目
POST /api/rooms
Header: Authorization: Bearer <token>
Body: { name: string, description?: string }
Response: { room: { id, name, description, created_at } }

// 获取项目详情
GET /api/rooms/:id
Header: Authorization: Bearer <token>
Response: { room: { ... }, members: [{ ... }] }

// 更新项目设置（仅 owner）
PATCH /api/rooms/:id
Header: Authorization: Bearer <token>
Body: { name?: string, description?: string }
Response: { room: { id, name, description } }

// 删除项目（仅 owner）
DELETE /api/rooms/:id
Header: Authorization: Bearer <token>
Response: { success: true }

// ─── 头像 ────────────────────────────────

// 上传头像（见上方 user/avatar）
// 头像静态文件通过 Fastify 的 fastify-static 插件提供访问
// URL 格式：/avatars/{user_id}.webp
```

### JWT Token 结构

```json
{
  "sub": "usr_abc123",
  "username": "zhangsan",
  "nickname": "张三",
  "role": "user",
  "iat": 1717700000,
  "exp": 1717786400
}
```

Token 有效期 24 小时，过期后用 refresh 接口刷新。

### 认证流程

```
注册/登录:
1. Client → POST /api/auth/login { username, password }
2. Server → 验证密码 → 签发 JWT
3. Client → 存 token 到 localStorage + authStore
4. Client → 跳转首页

WebSocket 连接:
1. Client → ws://host/ws?token=***
2. Server → 验证 token → 提取 user_id
3. Client → { action: "room.join", payload: { room_id: "rm_abc" } }
4. Server → 验证用户是否为房间成员 → 加入房间 → 推送成员列表

路由守卫:
- 未登录访问任何页面 → 重定向到 /login
- 已登录访问 /login → 重定向到 /（首页）
- Token 过期 → 自动 refresh → 失败则跳 /login
```

### Agent 认证

- Agent 使用独立的 token，由管理员通过 REST API 预生成
- Agent 的 `actor.id` 格式：`agent_{name}_{instance}`
- Agent token 中 `role` 字段为 `"ai"`

---

## 前端、移动端与部署细节

为控制架构文档体积，以下内容拆分到专题文档：

- [ARCHITECTURE-FRONTEND.md](./ARCHITECTURE-FRONTEND.md)：页面设计、移动端响应式、前端核心流程、部署方案与阶段规划。
