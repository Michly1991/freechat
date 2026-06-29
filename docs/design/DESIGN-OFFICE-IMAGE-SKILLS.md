# Office & Image Attachment Skills

> Superseded: 服务端不再负责 Office/PDF/图片内容处理。复杂文件应由 Agent Client 通过 `./freechat file download` 下载到本地后处理；服务端只做上传、下载、存储、权限和审计。详见 `DESIGN-FILE-PROCESSING-BOUNDARY.md`。

## Current boundary

历史目标是小蜜/Agent 通过服务端 App Action 读取和生成常见办公附件。最新边界已调整为：服务端不做复杂文件解析/生成，Agent Client 下载到本地处理。

## Tool policy

以下旧服务端处理工具不再执行内容解析/生成，在 registry 中标记为 `blocked`：

- `pdf.read`
- `excel.read`
- `word.read`
- `ppt.read`
- `image.read`
- `excel.write`
- `word.write`
- `ppt.write`

Agent 应改用：

- `file.download`：下载 `file:<fileId>` 到 Agent Client 本地。
- 本地 `skills/pdf-reader`、`skills/excel-reader`、`skills/word-reader`、脚本或系统工具：处理文件内容。
- `file.upload` / `file.write-local` / `tab.create-local`：把结果写回房间。

## Security

- 所有上传、下载和文本读取都使用当前 `actorUserId` 校验房间成员身份。
- `file:<fileId>` 不是访问令牌，只能在当前房间解析。
- Server 不接受 Agent Client 本地路径作为可读取文件。
- Server 不直接读取或写入 Client 本地文件系统。
- 写回用户可见结果必须通过房间文件 API 或 Tab API。

## UX Rule

遇到附件时，小蜜/Agent 应先确认 `file:<fileId>`，文本小文件可用 `file.read`；PDF/Excel/Word/PPT/图片必须先 `./freechat file download file:<fileId>` 下载到 Agent Client 本地，再用本地脚本/Skill/工具处理。不要在未下载或未处理前说看不到附件。
