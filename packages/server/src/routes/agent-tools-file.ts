import { mkdir, readFile, writeFile, stat, rm } from 'fs/promises'
import { dirname, join } from 'path'
import { tabConfigService } from '../services/tab-config.service.js'
import { tabFilesMapService } from '../services/tab-files-map.service.js'
import { roomFileService } from '../services/room-file.service.js'
import { assertProjectFilePathAllowed, buildFileTree, safeRelativePath } from './agent-tools.helpers.js'

interface FileToolContext {
  action: string
  args: any
  roomId: string
  filesDir: string
  broadcast: (roomId: string, action: string, payload: any) => void
  actorUserId?: string
}

function flattenFiles(items: any[], out: any[] = []): any[] {
  for (const item of items) {
    if (item.type === 'file') out.push(item)
    if (Array.isArray(item.children)) flattenFiles(item.children, out)
  }
  return out
}

function textReadLimit(args: any): number {
  const n = Number(args.limit || args.maxBytes || 200_000)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.trunc(n), 1_000_000) : 200_000
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${escaped}$`, 'i')
}

export async function handleFileTool(ctx: FileToolContext): Promise<{ handled: boolean; response?: any }> {
  const { action, args, roomId, filesDir, broadcast } = ctx
  switch (action) {
    case 'file.list': {
      await mkdir(filesDir, { recursive: true })
      const files = await buildFileTree(filesDir)
      const tab = await tabConfigService.getTab(roomId, 'files')
      const index = roomFileService.list(roomId)
      return { handled: true, response: { success: true, data: { files: tabConfigService.filterFileTree(files, tab), tabConfig: tab, folders: index.folders, fileRefs: index.files } } }
    }
    case 'file.glob': {
      await mkdir(filesDir, { recursive: true })
      const pattern = String(args.pattern || args.glob || '*')
      const re = globToRegExp(pattern)
      const files = flattenFiles(await buildFileTree(filesDir)).filter((file) => re.test(file.path))
      return { handled: true, response: { success: true, data: { pattern, files } } }
    }
    case 'file.read': {
      const rel = safeRelativePath(args.path)
      const fullPath = join(filesDir, rel)
      const info = await stat(fullPath)
      if (!info.isFile()) throw { code: 'VALIDATION_ERROR', message: 'path is not a file' }
      const allowed = /\.(txt|md|csv|json|log|yaml|yml|xml|html?|css|js|ts|tsx|jsx)$/i.test(rel)
      if (!allowed && args.force !== true) throw { code: 'BINARY_FILE_REQUIRES_DOWNLOAD', message: '该文件类型请先用 ./freechat file download 下载到本地处理；PDF/Excel/Word 等复杂文件不在服务端解析。' }
      const content = await readFile(fullPath, 'utf8')
      const offset = Math.max(0, Number(args.offset || 0) || 0)
      const limit = textReadLimit(args)
      return { handled: true, response: { success: true, data: { path: rel, content: content.slice(offset, offset + limit), offset, limit, truncated: offset + limit < content.length, totalChars: content.length } } }
    }
    case 'file.info': {
      const rel = safeRelativePath(args.path)
      const info = await stat(join(filesDir, rel))
      return { handled: true, response: { success: true, data: { path: rel, name: rel.split('/').pop(), size: info.size, modifiedAt: info.mtime.getTime(), type: info.isDirectory() ? 'directory' : 'file' } } }
    }
    case 'file.write': {
      const rel = safeRelativePath(args.path)
      assertProjectFilePathAllowed(rel)
      const fullPath = join(filesDir, rel)
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, String(args.content || ''), 'utf8')
      if (args.showInTab === true || args.addToTab === true) { await tabConfigService.addFile(roomId, String(args.tabKey || 'files'), rel); await tabFilesMapService.writeRoomMap(roomId) }
      broadcast(roomId, 'files.updated', { path: rel })
      const hint = /\.html?$/i.test(rel) ? `HTML 文件已写入项目文件区，但不会自动显示在页面区域。如需显示，请继续执行：./freechat tab create-file "页面标题" "${rel}" --default。写文件/页面前可随时执行 ./freechat tab files 查看目录地图。` : `文件已写入项目文件区${args.addToTab === true || args.showInTab === true ? '并加入文件 Tab' : '。如需在文件 Tab 显示，请加 --show 或执行 ./freechat file show ' + rel}。`
      return { handled: true, response: { success: true, data: { path: rel, hint } } }
    }
    case 'file.mkdir': {
      const rel = safeRelativePath(args.path)
      assertProjectFilePathAllowed(rel)
      await mkdir(join(filesDir, rel), { recursive: true })
      if (args.showInTab === true || args.addToTab === true) { await tabConfigService.addDir(roomId, String(args.tabKey || 'files'), rel); await tabFilesMapService.writeRoomMap(roomId) }
      broadcast(roomId, 'files.updated', { path: rel })
      return { handled: true, response: { success: true, data: { path: rel } } }
    }
    case 'file.promote': {
      const record = await roomFileService.promote(roomId, args.ref || args.path, args.targetPath || args.target, ctx.actorUserId || '')
      if (args.show === true || args.addToTab === true) { await tabConfigService.addFile(roomId, String(args.tabKey || 'files'), record.relativePath); await tabFilesMapService.writeRoomMap(roomId) }
      broadcast(roomId, 'files.updated', { path: record.relativePath, file: record })
      return { handled: true, response: { success: true, data: { file: record } } }
    }
    case 'file.delete': {
      const rel = safeRelativePath(args.path)
      await rm(join(filesDir, rel), { recursive: true, force: true })
      await tabConfigService.removeFile(roomId, String(args.tabKey || 'files'), rel).catch(() => {})
      await tabFilesMapService.writeRoomMap(roomId).catch(() => {})
      broadcast(roomId, 'files.updated', { path: rel })
      return { handled: true, response: { success: true, data: { path: rel } } }
    }
    default:
      return { handled: false }
  }
}
