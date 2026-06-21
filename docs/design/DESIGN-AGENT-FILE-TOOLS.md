# Agent 文件工具设计

## 背景

Agent Runtime 统一迁移到 Agent Client 后，Agent 不能依赖服务端本地文件路径。文件仍由 FreeChat Server 统一存储和鉴权，Agent Client 通过标准 CLI/API 下载、处理、上传。

## 职责边界

### Server

服务端保持最基本文件能力：

- 房间文件列表、glob 元数据匹配
- 文件元数据、简单文本读取
- 文件下载、上传
- 房间/Agent/工具权限校验
- 文件变更广播与 Tab 配置维护

服务端不负责复杂内容处理：

- PDF 解析
- Excel/Word 解析
- OCR
- 音视频解析
- 大文件内容索引

### Agent Client

客户端负责本地处理：

- 下载服务端房间文件到 Agent workspace
- 使用本地脚本、Python/Node 工具或系统工具处理 PDF/Excel/Word 等复杂文件
- 使用本地 `workspace glob/grep/cat/ls` 检索下载文件和中间产物
- 将处理结果上传回服务端房间文件区

## CLI

### 服务端文件命令

```bash
./freechat file list
./freechat file glob "**/*.pdf"
./freechat file info <path>
./freechat file read <path> [--limit <chars>] [--offset <chars>]
./freechat file download <path> [localPath]
./freechat file upload <localPath> [projectPath] [--show]
./freechat file write <path> <content> [--show]
./freechat file write-local <path> <localPath> [--show]
```

`file read` 只面向文本类文件；PDF、Excel、Word、图片等复杂文件会提示先 `download` 到本地处理。

### 本地 workspace 命令

```bash
./freechat workspace ls [path]
./freechat workspace glob "**/*.xlsx"
./freechat workspace grep "关键词" [--glob "**/*.txt"]
./freechat workspace cat <path>
```

这些命令只允许访问当前 Agent workspace，不能越界访问宿主机任意路径。

## API

Agent CLI 通过两类 API：

- `/api/agent-tools/:roomId`：JSON 工具调用，如 `file.list`、`file.glob`、`file.read`、`file.write`。
- `/api/agent-files/:roomId/download?path=...` 与 `/api/agent-files/:roomId/upload`：二进制下载/上传，使用 Agent tool token 或 remote Agent bearer 鉴权。

权限规则：

- Agent 必须在 room_agents 中属于该房间。
- Agent 必须拥有 file 工具权限。
- 不暴露服务端真实文件路径。
- 上传路径必须经过项目文件路径校验，禁止写入 `res/`、`scripts/`、`.freechat/` 等 Agent 私有/系统目录名。

## 推荐流程

PDF/Excel 示例：

```bash
./freechat file list
./freechat file download 合同.pdf
python scripts/analyze_pdf.py .freechat/files/合同.pdf > res/合同分析.md
./freechat file upload res/合同分析.md reports/合同分析.md --show
./freechat chat send "合同分析已完成，结果已上传到文件区。"
```

服务端只参与存取和权限控制，复杂解析由客户端环境完成。

## 服务端强控制与房间隔离

文件和目录由服务端强控制，客户端只提交上传、下载、promote 等意图。

强制规则：

1. 每个目录和文件都必须绑定唯一 `roomId`。
2. 所有文件查询、下载、上传、promote 都必须通过当前 URL/token 对应的 `roomId` 校验。
3. `fileId` 不是全局访问凭证；读取时必须使用 `roomId + fileId` 查询。
4. Agent 即使知道其他房间的 `fileId`，也不能跨房间下载、搜索、promote。
5. Agent Client 生成的 `./freechat` CLI 固定当前 `ROOM_ID`，不能切换房间。
6. 本地 `workspace` 命令只能访问当前房间/当前 Agent workspace。

## 房间文件元数据

新增服务端元数据：

- `room_file_folders`
- `room_files`

文件记录包含：

- `room_id`
- `folder_id`
- `id` / `ref=file:<id>`
- `relative_path`
- `source`
- `message_id?`

对话附件上传后也进入当前房间文件体系，默认目录：

```text
message-files/<messageId>/<filename>
```

消息 payload 中会携带附件的 `fileId/ref/folderId/relativePath/mimeType/size`，Agent prompt 中也会注入这些引用。Agent 通过：

```bash
./freechat file download file:<fileId>
```

下载到本地处理。
