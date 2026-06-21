# Agent Page/Tab Tools

## 目标

让大模型可以在服务端强控制下自主查询、编写、修改和受控操作房间页面 Tab。

## 权限

页面工具属于 `tab` 域。Agent 必须具备 `config.tools.tab = true` 才能调用：

- `tab.list`
- `tab.get` / `tab.read`
- `tab.search`
- `tab.create`
- `tab.create-from-file`
- `tab.update`
- `tab.patch`
- `tab.delete`
- `tab.reorder`
- `tab.set-default`
- `tab.open` / `tab.focus`
- `tab.action`

没有 tab 权限时服务端返回 `AGENT_TOOL_FORBIDDEN`。

## 查询页面

```bash
./freechat tab list
./freechat tab get <tabId|title>
./freechat tab search <query>
```

`tab.get` 返回页面完整内容，`tab.search` 返回标题/内容匹配和片段。

## 编写和修改页面

推荐大页面先写入本地工作区：

```bash
./freechat tab create-local "项目看板" res/dashboard.html
./freechat tab update-local <tabId> res/dashboard.html
```

也可以从项目文件创建/更新：

```bash
./freechat tab create-file "项目看板" ui/dashboard.html
./freechat tab update-file <tabId> ui/dashboard.html
```

局部替换：

```bash
./freechat tab patch <tabId|title> --find <oldText> --replace <newText>
./freechat tab patch-json res/tab-patch.json
```

`patch-json` 示例：

```json
{
  "target": "项目看板",
  "operations": [
    { "type": "replace", "find": "旧内容", "replace": "新内容" },
    { "type": "append", "content": "<section id=\"next\">...</section>" }
  ]
}
```

## 受控页面操作

Agent 不能执行任意浏览器 JS，只能向前端广播白名单动作：

```bash
./freechat tab open <tabId|title> --anchor summary
./freechat tab action <tabId|title> scrollTo --anchor risk-section
./freechat tab action <tabId|title> highlight --selector '[data-freechat-id="risk-1"]'
```

前端收到：

- `tab.open`：切换当前页面，并可滚动到锚点。
- `tab.action`：当前支持 `open`、`scrollTo`、`highlight`。

## 页面编写约定

为了便于 Agent 后续定位和局部修改，页面应使用稳定标识：

```html
<section id="risk-section" data-freechat-id="risk-1">
  ...
</section>
```

页面应尽量自包含，不依赖外部 CDN；需要读取房间文件时使用页面桥接的 `window.freechat.readFile(path)`，后续可扩展为基于 `file:<fileId>` 的读取。

## 服务端职责

- 所有 Tab 查询和修改均按 `roomId` 限定。
- 删除、更新、局部替换都只影响当前房间页面。
- 操作页面只通过 WebSocket 广播受控事件，不提供任意脚本执行能力。

## Agent Client 同步

Tab/Page API 已进入服务端 runtime spec。Agent Client 每次执行前拉取最新 spec，生成最新 `./freechat` 和 `.freechat/API.md`，避免客户端 CLI 与服务端能力分叉。
