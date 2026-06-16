# FreeChat Tab 文件配置设计

## 目标

每个功能 Tab 必须先有配置，明确它能显示哪些文件项。不在配置文件里的文件，即使实际存在于项目 `files/` 目录，也不在对应 Tab 中显示。

## 配置位置

Tab 配置属于系统元数据，不放在用户可见文件 Tab 中：

```text
workspace-data/{roomId}/meta/tabs.json
```

## 配置结构

```json
{
  "version": 1,
  "tabs": {
    "files": {
      "title": "文件",
      "visibleFiles": ["20字作文.txt"],
      "visibleDirs": ["docs"]
    },
    "tabs": {
      "title": "标签",
      "visibleFiles": [],
      "visibleDirs": []
    },
    "tasks": {
      "title": "任务",
      "visibleFiles": [],
      "visibleDirs": []
    }
  }
}
```

## 规则

- `visibleFiles` 是文件路径白名单。
- `visibleDirs` 是目录路径白名单；目录下文件允许显示。
- 不在白名单中的文件/目录不返回给前端。
- 缺失配置时自动创建空配置；默认不显示任何文件。
- 前端文件 Tab 显示后端过滤后的文件树，并提示“仅显示已加入当前 Tab 配置的文件”。

## API

```text
GET    /api/rooms/:roomId/tab-config/:tabKey
POST   /api/rooms/:roomId/tab-config/:tabKey/files
DELETE /api/rooms/:roomId/tab-config/:tabKey/files
POST   /api/rooms/:roomId/tab-config/:tabKey/dirs
```

Agent Tool API 对应动作：

```text
tab-config.list
tab-config.add-file
tab-config.remove-file
```

## Agent 行为

Agent 写项目文件与文件 Tab 可见性分离：

```bash
./freechat file write 20字作文.txt "内容"
./freechat tab-config add-file 20字作文.txt
```

也可以一行写入并加入文件 Tab：

```bash
./freechat file write 20字作文.txt "内容" true
```

如果只写文件但不加入 Tab 配置，文件存在于项目目录，但前端文件 Tab 不显示。

## 移动端

文件 Tab 在移动端默认显示文件列表；打开文件后切换到编辑界面，并提供“← 文件列表”返回按钮。

## Agent Tab 文件目录地图（2026-06-16）

为避免 Agent/助理把正式交付物写错到私有工作区或系统目录，系统会为每个房间生成：

```text
.freechat/workspace-data/<roomId>/.freechat/TAB_FILES.md
.freechat/workspace-data/<roomId>/agents/<agentId>/.freechat/TAB_FILES.md
```

`TAB_FILES.md` 是 Agent 必读的 Tab / 文件目录地图，包含：

- 当前 Agent 私有工作区位置。
- 当前房间项目文件根目录。
- 每个 Tab 的 `visibleFiles` / `visibleDirs`。
- 推荐项目路径：`docs/`、`ui/`、`正文/`、`剧情/`、`角色/`、`设定/`、`素材/`、`reports/`。
- HTML 页面展示和项目文件留档的区别。
- 禁止写入的项目路径：`res/`、`scripts/`、`skills/`、`agents/`、`.freechat/`、`meta/` 等。

Agent CLI 提供：

```bash
./freechat tab files
```

该命令会刷新并输出当前房间的目录地图。Agent 在写任何项目文件、页面、交付物前，必须先阅读 `.freechat/TAB_FILES.md` 或执行 `./freechat tab files`。

后端 `file.write` / `file.write-local` / `file.mkdir` / `tab-config.add-file` 会拒绝明显错误的项目路径，防止把正式交付物写到 Agent 私有目录或系统目录。
