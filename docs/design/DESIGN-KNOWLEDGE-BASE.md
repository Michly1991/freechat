# FreeChat 知识库设计

## 当前口径：Agent 知识库在客户端

随着 Agent Runtime 统一迁移到 Agent Client，知识库边界调整为：

- Agent 知识库存在 Agent Client 本地，由客户端维护。
- FreeChat Server 不默认保存 Agent 知识库正文，也不在 Agent 执行前注入服务端知识库内容。
- Server 负责 Agent 身份、发布、权限、调度、运行记录、计费和消息。
- Client 负责 Agent 执行环境、工作目录、本地工具、运行日志和知识库。
- 如果未来需要把客户端知识同步/发布到服务端，必须设计显式授权、同步方向和可见性，不能默认上传。

## Agent 编辑页展示

Agent Client 控制台的 Agent 列表只做浏览、状态和快捷操作；复杂编辑进入独立 Agent 编辑页。

编辑页中的“客户端知识库”分区展示：

- Agent 客户端知识库目录，例如 `<agent-workspace>/knowledge`。
- Agent 工作区目录。
- `.freechat` 运行规范缓存目录。
- 是否存在、文件/目录数量、最近更新时间和前若干条目录项。

如果 Agent 尚未被本客户端接管，编辑页只显示预留目录和提示：需先由本客户端接管执行，才能管理本地知识库。

## 服务端历史知识库

早期 MVP 曾设计 `knowledge_entries` 服务端表，包含 `public | agent | room` 三层知识，并由服务端在 Agent 执行前检索注入。

该方案已不作为当前 Agent Runtime 的执行路径：

- `knowledge_entries` 可作为历史/兼容数据保留。
- 新的 Agent 执行链路不再调用服务端 `getRuntimeContext` 注入知识。
- 服务端知识管理若继续保留，需要重新定义为“公共资料库/房间资料库”等非默认 Agent 私有知识来源，并通过显式授权同步到客户端或被客户端按权限拉取。

## 安全边界

- 客户端本地知识库不自动上传服务端。
- 服务端不存储客户端本地文件正文。
- 公网访问 Agent Client 控制台时，必须依赖管理员密码、HTTPS 反向代理、IP 白名单等安全措施。
- 对本地路径、文件扫描、索引和知识库编辑的操作都应在 Agent Client 执行。
