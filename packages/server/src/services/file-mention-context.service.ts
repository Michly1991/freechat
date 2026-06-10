import { readFile, stat } from 'fs/promises'
import { extname, join, normalize } from 'path'
import { config } from '../config.js'

const MAX_INLINE_CHARS = 20_000
const TEXT_EXTS = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx', '.html', '.css', '.xml', '.yaml', '.yml', '.log'])

export function safeRoomFilePath(input = '') {
  const cleaned = normalize(input).replace(/^([/\\])+/, '')
  if (!cleaned || cleaned === '.') throw { code: 'INVALID_PATH', message: 'path is required' }
  if (cleaned.startsWith('..') || cleaned.includes('..\\') || cleaned.includes('../')) throw { code: 'INVALID_PATH', message: 'Path escapes room workspace' }
  return cleaned.replace(/\\/g, '/')
}

function isTextLike(path: string, mimeType?: string) {
  if (mimeType?.startsWith('text/')) return true
  if (mimeType && /json|xml|yaml|csv|javascript|typescript/.test(mimeType)) return true
  return TEXT_EXTS.has(extname(path).toLowerCase())
}

export class FileMentionContextService {
  async build(roomId: string, mentions: any[] = []) {
    const files = mentions.filter((m) => m?.type === 'file' || m?.role === 'file')
    if (!files.length) return ''
    const blocks: string[] = []
    for (const file of files.slice(0, 5)) {
      const rel = safeRoomFilePath(file.path || file.id || file.name)
      const fullPath = join(config.workspace.root, roomId, 'files', rel)
      const stats = await stat(fullPath).catch(() => null)
      if (!stats?.isFile()) {
        blocks.push(`[文件] ${file.name || rel}\n路径：${rel}\n状态：文件不存在或不可读取`)
        continue
      }
      const mimeType = file.mimeType || file.typeHint || ''
      let content = ''
      if (isTextLike(rel, mimeType)) {
        const raw = await readFile(fullPath, 'utf8')
        content = raw.length > MAX_INLINE_CHARS ? `${raw.slice(0, MAX_INLINE_CHARS)}\n\n[内容过长，仅内联前 ${MAX_INLINE_CHARS} 字符；如需完整内容，请使用 ./freechat file read ${rel}]` : raw
      } else {
        content = `[非文本文件，已提供路径和元信息；如需处理，请用 ./freechat file read/info 查看，或请求用户转换/补充。]`
      }
      blocks.push(`[文件] ${file.name || rel}\n路径：${rel}\n大小：${stats.size} bytes${mimeType ? `\n类型：${mimeType}` : ''}\n内容：\n${content}`)
    }
    return `\n\n用户在消息中 @ 了以下项目文件。请把 @文件 当作明确上下文，不要猜错文件；需要完整内容时使用 ./freechat file read <path>。\n\n${blocks.join('\n\n---\n\n')}`
  }
}

export const fileMentionContextService = new FileMentionContextService()
