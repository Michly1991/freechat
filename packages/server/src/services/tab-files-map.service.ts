import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { config } from '../config.js'
import db from '../storage/db.js'
import { tabConfigService, type RoomTabConfig } from './tab-config.service.js'

function formatList(items: string[], empty = '- none') {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : empty
}

function normalizeDir(path: string) {
  return path.endsWith('/') ? path : `${path}/`
}

class TabFilesMapService {
  async render(roomId: string): Promise<string> {
    const cfg = await tabConfigService.getConfig(roomId)
    const tabs = db.prepare(`SELECT t.id, t.title, t.icon, t.updated_at, CASE WHEN p.default_tab_id = t.id THEN 1 ELSE 0 END as is_default FROM tabs t LEFT JOIN room_tab_preferences p ON p.room_id = t.room_id WHERE t.room_id = ? ORDER BY t.sort_order ASC, t.created_at ASC`).all(roomId) as any[]
    const projectRoot = `.freechat/workspace-data/${roomId}/files/`
    const agentRoot = `.freechat/workspace-data/${roomId}/agents/<agentId>/`

    const tabSections = Object.entries(cfg.tabs).map(([key, tab]) => this.renderConfigTab(key, tab)).join('\n\n')
    const pageSections = tabs.length ? tabs.map((tab) => [
      `### 页面：${tab.title}`,
      `- Page Tab ID: ${tab.id}`,
      `- Default: ${tab.is_default ? 'yes' : 'no'}`,
      '- 页面内容由 `./freechat tab create-* / update-*` 管理，不等同于文件 Tab。',
      '- 如需把 HTML 同时作为项目交付文件留档，推荐项目路径：`ui/<页面名>.html`，再用 `./freechat file write-local ui/<页面名>.html res/<页面名>.html --show`。',
    ].join('\n')).join('\n\n') : '- 当前还没有页面 Tab。'

    return `# 当前房间 Tab / 文件目录地图\n\n更新时间：${new Date().toISOString()}\n\n## 必须遵守的硬规则\n\n- 当前 Agent 工作区是私有目录：\`${agentRoot}\`。\n- 私有草稿、脚本、临时资源只能放在 Agent cwd 下的 \`res/\`、\`scripts/\`、\`skills/\`。\n- 用户能看到的正式项目文件位于：\`${projectRoot}\`。\n- 不要直接读写底层 \`files/\` 目录；必须通过 \`./freechat file ...\`。\n- 不要把正式交付物写到项目路径 \`res/\`、\`scripts/\`、\`skills/\`、\`agents/\`、\`.freechat/\`。这些路径会被拒绝或视为错误。\n- 写正式文件请使用业务路径，例如：\`docs/...\`、\`ui/...\`、\`正文/...\`、\`剧情/...\`、\`角色/...\`、\`设定/...\`、\`素材/...\`、\`reports/...\`。\n- 写完希望用户在“文件”Tab 看到的文件，必须加 \`--show\`，或执行 \`./freechat file show <path>\`。\n- \`--show\` 只会加入“文件”Tab；HTML 不会自动变成页面。\n- HTML 要显示在页面区域，必须执行 \`./freechat tab create-local/create-file/update-local/update-file\`，主页面建议加 \`--default\`。\n\n## 当前房间项目文件根目录\n\n底层路径：\n\n\`\`\`text\n${projectRoot}\n\`\`\`\n\nAgent 不应直接写这个底层路径，只能使用相对项目路径配合 CLI，例如：\n\n\`\`\`bash\n./freechat file write docs/progress.md "内容" --show\n./freechat file write-local docs/report.md res/report.md --show\n./freechat file write-local ui/dashboard.html res/dashboard.html --show\n./freechat tab create-local "项目看板" res/dashboard.html --default\n./freechat tab create-file "项目看板" ui/dashboard.html --default\n\`\`\`\n\n## 文件可见性 Tab 配置\n\n${tabSections}\n\n## 页面 Tab\n\n${pageSections}\n\n## 写入决策速查\n\n- Markdown / 文档 / 小说正文 / 报告：写到 \`docs/\`、\`正文/\`、\`剧情/\`、\`reports/\` 等项目路径，并加 \`--show\`。\n- HTML 页面草稿：先写到私有 \`res/<name>.html\`。\n- HTML 页面展示：用 \`./freechat tab create-local "标题" res/<name>.html --default\`。\n- HTML 作为项目文件留档：再用 \`./freechat file write-local ui/<name>.html res/<name>.html --show\`。\n- 任务进展：不要写文件，使用 \`./freechat task progress ...\`。\n- 不确定写哪里：先执行 \`./freechat tab files\` 查看本文件。\n`
  }

  async writeRoomMap(roomId: string): Promise<string> {
    const content = await this.render(roomId)
    const dir = join(config.workspace.root, roomId, '.freechat')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'TAB_FILES.md'), content, 'utf8')
    return content
  }

  async writeAgentMap(roomId: string, agentId: string): Promise<string> {
    const content = await this.render(roomId)
    const dir = join(config.workspace.root, roomId, 'agents', agentId, '.freechat')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'TAB_FILES.md'), content, 'utf8')
    return content
  }

  private renderConfigTab(key: string, tab: RoomTabConfig['tabs'][string]) {
    const dirs = (tab.visibleDirs || []).map(normalizeDir)
    const files = tab.visibleFiles || []
    const recommended = key === 'files'
      ? ['docs/', 'ui/', '正文/', '剧情/', '角色/', '设定/', '素材/', 'reports/']
      : key === 'tabs'
        ? ['ui/']
        : key === 'tasks'
          ? ['任务不直接对应文件目录，使用 ./freechat task ...']
          : ['docs/', 'ui/', 'reports/']
    return [
      `### Tab: ${tab.title || key}`,
      `- Tab Key: ${key}`,
      `- 推荐项目路径：
${recommended.length ? recommended.map((item) => `  - ${item}`).join('\n') : '  - docs/'}`,
      `- 当前可见目录：
${dirs.length ? dirs.map((item) => `  - ${item}`).join('\n') : '  - none'}`,
      `- 当前可见文件：
${files.length ? files.map((item) => `  - ${item}`).join('\n') : '  - none'}`,
    ].join('\n')
  }
}

export const tabFilesMapService = new TabFilesMapService()
