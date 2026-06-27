# Office & Image Attachment Skills

## Goal

小蜜/Agent 通过服务端 App Action 读取和生成常见办公附件，避免用户上传 PDF/Excel/Word/PPT/图片后 Agent 说“看不到”。

## Tool Surface

- `pdf.read`：提取 PDF 文本，可传 `pageRange`。
- `excel.read`：读取 Excel sheet/range，可传 `sheet`、`range`、`maxRows`、`maxCols`。
- `excel.write`：生成 `.xlsx` 并写回当前房间文件区。
- `word.read`：提取 `.docx` 文本。
- `word.write`：生成 `.docx` 并写回当前房间文件区。
- `ppt.read`：提取 `.pptx` 幻灯片文本，可传 `slideRange`。
- `ppt.write`：生成 `.pptx` 并写回当前房间文件区。
- `image.read`：调用当前 Agent 生效模型的视觉能力，支持 `describe`、`ocr`、`extract_table`。

## Security

- 所有读取和写入都使用当前 `actorUserId` 校验房间成员身份。
- `file:<fileId>` 不是访问令牌，只能在当前房间解析。
- 写入只允许通过房间文件区路径，不能逃逸到服务器任意路径。
- 大内容读取有 `limit/maxRows/maxCols/pageRange/slideRange` 限制。
- 图片最大 8MB；视觉调用按当前 Agent 生效模型与计费路径处理。

## UX Rule

遇到附件时，小蜜应按类型优先调用对应工具：

- 文本：`file.read`
- PDF：`pdf.read`
- Excel：`excel.read`
- Word：`word.read`
- PPT：`ppt.read`
- 图片：`image.read`

不要在未调用工具前说看不到附件。
