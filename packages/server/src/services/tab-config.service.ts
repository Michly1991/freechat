import { mkdir, readFile, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { dirname, join, normalize } from 'path'
import { config } from '../config.js'

export interface TabFileConfig {
  title?: string
  visibleFiles: string[]
  visibleDirs: string[]
}

export interface RoomTabConfig {
  version: 1
  tabs: Record<string, TabFileConfig>
}

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: number
  children?: FileTreeNode[]
}

function safeRelativePath(input = ''): string {
  const cleaned = normalize(input).replace(/^([/\\])+/, '')
  if (!cleaned || cleaned === '.') throw { code: 'INVALID_PATH', message: 'path is required' }
  if (cleaned.startsWith('..') || cleaned.includes(`..\\`) || cleaned.includes('../')) {
    throw { code: 'INVALID_PATH', message: 'Path escapes room workspace' }
  }
  return cleaned.replace(/\\/g, '/')
}

class TabConfigService {
  private configPath(roomId: string) {
    return join(config.workspace.root, roomId, 'meta', 'tabs.json')
  }

  private defaultConfig(): RoomTabConfig {
    return {
      version: 1,
      tabs: {
        files: { title: '文件', visibleFiles: [], visibleDirs: [] },
        tabs: { title: '标签', visibleFiles: [], visibleDirs: [] },
        tasks: { title: '任务', visibleFiles: [], visibleDirs: [] }
      }
    }
  }

  async getConfig(roomId: string): Promise<RoomTabConfig> {
    const path = this.configPath(roomId)
    if (!existsSync(path)) {
      const cfg = this.defaultConfig()
      await this.saveConfig(roomId, cfg)
      return cfg
    }

    try {
      const raw = await readFile(path, 'utf8')
      const parsed = JSON.parse(raw)
      return this.normalizeConfig(parsed)
    } catch {
      const cfg = this.defaultConfig()
      await this.saveConfig(roomId, cfg)
      return cfg
    }
  }

  async saveConfig(roomId: string, cfg: RoomTabConfig): Promise<void> {
    const path = this.configPath(roomId)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(this.normalizeConfig(cfg), null, 2), 'utf8')
  }

  async getTab(roomId: string, tabKey: string): Promise<TabFileConfig> {
    const cfg = await this.getConfig(roomId)
    return cfg.tabs[tabKey] || { title: tabKey, visibleFiles: [], visibleDirs: [] }
  }

  async addFile(roomId: string, tabKey: string, path: string): Promise<TabFileConfig> {
    const rel = safeRelativePath(path)
    const cfg = await this.getConfig(roomId)
    const tab = cfg.tabs[tabKey] || { title: tabKey, visibleFiles: [], visibleDirs: [] }
    if (!tab.visibleFiles.includes(rel)) tab.visibleFiles.push(rel)
    tab.visibleFiles.sort((a, b) => a.localeCompare(b))
    cfg.tabs[tabKey] = tab
    await this.saveConfig(roomId, cfg)
    return tab
  }

  async removeFile(roomId: string, tabKey: string, path: string): Promise<TabFileConfig> {
    const rel = safeRelativePath(path)
    const cfg = await this.getConfig(roomId)
    const tab = cfg.tabs[tabKey] || { title: tabKey, visibleFiles: [], visibleDirs: [] }
    tab.visibleFiles = tab.visibleFiles.filter((item) => item !== rel)
    tab.visibleDirs = tab.visibleDirs.filter((item) => item !== rel)
    cfg.tabs[tabKey] = tab
    await this.saveConfig(roomId, cfg)
    return tab
  }

  async addDir(roomId: string, tabKey: string, path: string): Promise<TabFileConfig> {
    const rel = safeRelativePath(path)
    const cfg = await this.getConfig(roomId)
    const tab = cfg.tabs[tabKey] || { title: tabKey, visibleFiles: [], visibleDirs: [] }
    if (!tab.visibleDirs.includes(rel)) tab.visibleDirs.push(rel)
    tab.visibleDirs.sort((a, b) => a.localeCompare(b))
    cfg.tabs[tabKey] = tab
    await this.saveConfig(roomId, cfg)
    return tab
  }

  filterFileTree(nodes: FileTreeNode[], tab: TabFileConfig): FileTreeNode[] {
    const files = new Set((tab.visibleFiles || []).map((p) => safeRelativePath(p)))
    const dirs = new Set((tab.visibleDirs || []).map((p) => safeRelativePath(p)))

    const isFileVisible = (path: string) => files.has(path) || Array.from(dirs).some((dir) => path === dir || path.startsWith(`${dir}/`))
    const isDirExplicitlyVisible = (path: string) => dirs.has(path)
    const hasVisibleDescendant = (path: string) => Array.from(files).some((file) => file.startsWith(`${path}/`)) || Array.from(dirs).some((dir) => dir.startsWith(`${path}/`))

    const visit = (node: FileTreeNode): FileTreeNode | null => {
      if (node.type === 'file') return isFileVisible(node.path) ? node : null

      const children = (node.children || []).map(visit).filter(Boolean) as FileTreeNode[]
      if (isDirExplicitlyVisible(node.path) || children.length > 0 || hasVisibleDescendant(node.path)) {
        return { ...node, children }
      }
      return null
    }

    return nodes.map(visit).filter(Boolean) as FileTreeNode[]
  }

  private normalizeConfig(input: any): RoomTabConfig {
    const base = this.defaultConfig()
    const tabs = input?.tabs && typeof input.tabs === 'object' ? input.tabs : {}
    for (const [key, value] of Object.entries(tabs)) {
      const tab = value as any
      base.tabs[key] = {
        title: typeof tab?.title === 'string' ? tab.title : key,
        visibleFiles: Array.isArray(tab?.visibleFiles) ? Array.from(new Set(tab.visibleFiles.map((p: any) => safeRelativePath(String(p))).filter(Boolean))) : [],
        visibleDirs: Array.isArray(tab?.visibleDirs) ? Array.from(new Set(tab.visibleDirs.map((p: any) => safeRelativePath(String(p))).filter(Boolean))) : []
      }
    }
    return base
  }
}

export const tabConfigService = new TabConfigService()
