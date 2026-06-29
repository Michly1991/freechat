# File Attachment Processing Boundary

## Goal

FreeChat must work when FreeChat Server and Agent Client run on different machines. Therefore, Server must not assume it can execute Agent-side file processing or see Agent Client local paths.

Decision: **Server only provides basic file upload, download, storage, metadata, permission and audit capabilities. File parsing, conversion, OCR, Office/PDF/image processing are done by Agent Client after downloading the file locally.**

## Responsibilities

### FreeChat Server

Allowed responsibilities:

- Upload room files and message attachments.
- Download room files and message attachments.
- Manage file metadata, `file:<fileId>`, room paths and File Tab visibility.
- Enforce user, room and Agent permissions.
- Audit file operations and broadcast file changes.
- Read small text files through `file.read` for lightweight text formats such as Markdown, txt, json and csv.

Server must not:

- Extract PDF text.
- Parse or generate Excel, Word or PPT files.
- Run image understanding, OCR or table recognition.
- Convert complex binary files.
- Read an Agent Client local absolute path.

### Agent Client

Agent Client handles content processing:

1. Receive `file:<fileId>` or a room file path.
2. Download the file through the authorized Server API: `./freechat file download file:<fileId> res/input.ext`.
3. Process the local file with local scripts, Skills, system tools or model capabilities.
4. Write user-visible results back through Server APIs, for example `./freechat file upload res/result.md reports/result.md --show`, `./freechat file write-local reports/result.md res/result.md --show`, `./freechat tab create-local "Result Page" res/page.html`, or `./freechat chat send "Short conclusion..."`.

## Two-machine constraints

- Server paths and Client paths are separate and must not be treated as shared.
- Server must not accept a Client local absolute path as a readable room file.
- Client must not directly read or write Server `.freechat/workspace-data/rooms/<roomId>/files` directories.
- `file:<fileId>` is not an access token; Server must validate `roomId + actorUserId + agentId` before download.
- User-visible Client outputs must return to the room file system through upload/write APIs.

## Tool policy

### Server basic tools

- `file.list`
- `file.info`
- `file.read` for small text files only
- `file.download` through Agent CLI download API
- `file.upload`
- `file.write`
- `file.write-local`
- `file.promote`
- `file.delete`

### Blocked server-side processing tools

The following App Actions are not executed on Server and are marked `blocked` in the registry. They exist only as guidance that the Agent should switch to `file.download` plus local processing:

- `pdf.read`
- `excel.read`
- `word.read`
- `ppt.read`
- `image.read`
- `excel.write`
- `word.write`
- `ppt.write`

If called, Server returns `CLIENT_FILE_PROCESSING_REQUIRED`.

## Recommended Agent workflows

- Read Excel: download with `./freechat file download file:<fileId> res/input.xlsx`, extract locally with `python skills/excel-reader/scripts/extract_excel.py res/input.xlsx res/input.md`, then answer or upload outputs.
- Generate a report: build `res/report.md` locally, then upload with `./freechat file upload res/report.md reports/report.md --show`.
- Generate a page: build `res/page.html` locally, then publish with `./freechat tab create-local "Analysis Result" res/page.html`.

## Platform-hosted Agent limitation

Platform-hosted Agent runs on the Server side and has no separate Agent Client local processing environment. Since Server does not process complex files, platform-hosted Agent should:

- Read small text files only.
- For PDF/Excel/Word/PPT/images, explain that a remote Agent Client is required to download and process the file locally, or ask the user to provide text content.
- Not attempt to call server-side `excel.read/pdf.read/...` parsing tools.

## Trade-off

This sacrifices “Server parses every file directly”, but provides:

- Clearer Server responsibilities: storage, permission, audit and transfer.
- More flexible Client processing using local dependencies and tools.
- Correct behavior for two-machine deployments.
- Lower Server dependency, resource and security burden.
