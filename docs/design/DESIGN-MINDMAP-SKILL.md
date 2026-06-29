# DESIGN-MINDMAP-SKILL

## Goal

脑图是 Agent Skill，而不是聊天系统硬编码业务功能。小蜜或普通 Agent 在用户要求“脑图 / 思维导图 / XMind 风格结构图 / 框架拆解”时，通过 Mindmap Skill 生成聊天内嵌预览。

## Product Rules

- 默认只展示预览，不进入长期存储。
- 如果前端可直接展示，预览内容随消息 payload 返回。
- 如果内容过大或需要 URL，服务端可写入房间 `tmp/artifacts/mindmaps/<previewId>/`，该目录属于缓存，可按 TTL 清理。
- 用户确认“保存 / 留下 / 存到房间 / 导出”后，才调用 `mindmap.save` 写入正式房间文件。
- 首版不做在线编辑；用户要求调整时重新生成。

## App Actions

### `mindmap.create`

输入：

- `title` / `topic`
- `outline` / `markdown`：Markdown 标题或列表大纲
- `root` / `mindmap`：JSON 节点树

输出：

```json
{
  "preview": {
    "id": "mindmap_xxx",
    "artifactType": "mindmap",
    "title": "...",
    "svg": "<svg ...>",
    "html": "<!doctype html>...",
    "storage": "inline|tmp",
    "tmpPath": "tmp/artifacts/mindmaps/..."
  }
}
```

执行成功后，服务端会额外创建一条 `artifact_preview` 消息，payload 为：

```json
{
  "artifactType": "mindmap",
  "preview": { "...": "..." }
}
```

前端聊天气泡识别该消息并用 sandbox iframe 展示。

### `mindmap.save`

输入：

- `previewId`：保存已有临时预览；或直接传 `html/svg/root/title`
- `targetDir`：可选正式保存目录

输出正式房间文件：

```text
files/mindmaps/<title>-<timestamp>/
├── index.html
├── preview.svg
└── mindmap.json
```

这些文件会记录到 `room_files`，用户可在房间文件中管理。

## Skill Mounting

系统公共 Skill 目录新增：

```text
.freechat/workspace-data/system-skills/mindmap/
├── SKILL.md
├── res/
└── scripts/
```

Agent 工作区准备时会挂载到：

```text
rooms/<roomId>/agents/<agentId>/skills/mindmap/
```

Agent 遇到脑图需求时应先读取 `skills/mindmap/SKILL.md`。

## Security

- 聊天不允许 Agent 任意注入主页面 HTML。
- Mindmap HTML 仅作为受控 artifact 渲染。
- 前端使用 `<iframe sandbox="allow-scripts">` 内嵌，隔离主应用 DOM。
- 正式保存仍按 `actorUserId + roomId` 校验房间成员权限。
