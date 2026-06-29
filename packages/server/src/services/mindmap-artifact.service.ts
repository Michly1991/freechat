import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { config } from '../config.js'
import { safeRelativePath } from '../routes/agent-tools.helpers.js'
import { roomFileService } from './room-file.service.js'

export interface MindmapNode {
  id: string
  text: string
  children: MindmapNode[]
}

export interface MindmapPreview {
  id: string
  roomId: string
  title: string
  root: MindmapNode
  svg: string
  html: string
  storage: 'inline' | 'tmp'
  sourceRefs?: string[]
  tmpPath?: string
  createdAt: number
  expiresAt: number
}

const INLINE_SVG_LIMIT = 180_000
const TMP_TTL_MS = 24 * 60 * 60 * 1000

function text(value: any, fallback = ''): string {
  return String(value ?? fallback).trim()
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch] || ch))
}

function slug(value: string): string {
  return (value || 'mindmap').replace(/[^\u4e00-\u9fa5a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'mindmap'
}

function makeNode(label: string, children: MindmapNode[] = []): MindmapNode {
  return { id: `node_${uuidv4()}`, text: text(label, '未命名节点'), children }
}

function nodeFromInput(input: any, fallback = '脑图'): MindmapNode {
  if (typeof input === 'string') return makeNode(input)
  if (!input || typeof input !== 'object') return makeNode(fallback)
  const childrenInput = Array.isArray(input.children) ? input.children : Array.isArray(input.nodes) ? input.nodes : []
  return makeNode(input.text || input.title || input.name || fallback, childrenInput.map((child: any, index: number) => nodeFromInput(child, `节点 ${index + 1}`)))
}

function outlineToNode(markdown: string, fallbackTitle: string): MindmapNode {
  const lines = String(markdown || '').split(/\r?\n/)
    .map((raw) => {
      const line = raw.replace(/\t/g, '  ').trimEnd()
      if (!line.trim()) return null
      const heading = line.match(/^(#{1,6})\s+(.+)$/)
      if (heading) return { level: heading[1].length - 1, label: heading[2].trim() }
      const bullet = line.match(/^(\s*)(?:[-*+]\s+|\d+[.)]\s+)(.+)$/)
      if (bullet) return { level: Math.floor(bullet[1].length / 2), label: bullet[2].trim() }
      return { level: 1, label: line.trim() }
    })
    .filter(Boolean) as Array<{ level: number; label: string }>
  if (!lines.length) return makeNode(fallbackTitle)
  const first = lines[0]
  const root = makeNode(first.level === 0 ? first.label : fallbackTitle)
  const stack: Array<{ level: number; node: MindmapNode }> = [{ level: 0, node: root }]
  const start = first.level === 0 ? 1 : 0
  for (const item of lines.slice(start)) {
    const node = makeNode(item.label)
    while (stack.length > 1 && stack[stack.length - 1].level >= item.level + 1) stack.pop()
    const parent = stack[stack.length - 1]?.node || root
    parent.children.push(node)
    stack.push({ level: item.level + 1, node })
  }
  return root
}

function fromFlatTopics(title: string, topics: any[]): MindmapNode {
  return makeNode(title, topics.slice(0, 12).map((item, index) => {
    if (typeof item === 'string') return makeNode(item)
    const children = Array.isArray(item.children) ? item.children.map((child: any, i: number) => nodeFromInput(child, `子节点 ${i + 1}`)) : []
    return makeNode(item.text || item.title || item.name || `主题 ${index + 1}`, children)
  }))
}

function measure(root: MindmapNode) {
  let count = 0
  let depth = 0
  const walk = (node: MindmapNode, level: number) => {
    count += 1
    depth = Math.max(depth, level)
    node.children.forEach((child) => walk(child, level + 1))
  }
  walk(root, 0)
  return { count, depth }
}

function renderSvg(root: MindmapNode, title: string): string {
  const levels = new Map<number, MindmapNode[]>()
  const walk = (node: MindmapNode, depth: number) => {
    levels.set(depth, [...(levels.get(depth) || []), node])
    node.children.forEach((child) => walk(child, depth + 1))
  }
  walk(root, 0)
  const rows = Array.from(levels.entries()).sort(([a], [b]) => a - b)
  const maxItems = Math.max(...rows.map(([, nodes]) => nodes.length), 1)
  const width = Math.max(720, rows.length * 260 + 120)
  const height = Math.max(360, maxItems * 96 + 120)
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>()
  for (const [depth, nodes] of rows) {
    const gap = height / (nodes.length + 1)
    nodes.forEach((node, index) => positions.set(node.id, { x: 60 + depth * 250, y: gap * (index + 1), w: depth === 0 ? 170 : 190, h: 46 }))
  }
  const links: string[] = []
  const nodes: string[] = []
  const draw = (node: MindmapNode, depth: number) => {
    const pos = positions.get(node.id)!
    for (const child of node.children) {
      const next = positions.get(child.id)!
      links.push(`<path d="M ${pos.x + pos.w} ${pos.y} C ${pos.x + pos.w + 60} ${pos.y}, ${next.x - 60} ${next.y}, ${next.x} ${next.y}" fill="none" stroke="#93c5fd" stroke-width="2.2"/>`)
      draw(child, depth + 1)
    }
    const fill = depth === 0 ? '#2563eb' : depth === 1 ? '#eff6ff' : '#ffffff'
    const stroke = depth === 0 ? '#1d4ed8' : '#bfdbfe'
    const color = depth === 0 ? '#ffffff' : '#1f2937'
    const label = escapeHtml(node.text.length > 28 ? `${node.text.slice(0, 27)}…` : node.text)
    nodes.push(`<g class="node"><rect x="${pos.x}" y="${pos.y - pos.h / 2}" width="${pos.w}" height="${pos.h}" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/><text x="${pos.x + pos.w / 2}" y="${pos.y + 5}" text-anchor="middle" font-size="14" font-weight="${depth === 0 ? 700 : 500}" fill="${color}">${label}</text><title>${escapeHtml(node.text)}</title></g>`)
  }
  draw(root, 0)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(title)}"><defs><filter id="shadow" x="-10%" y="-20%" width="130%" height="150%"><feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#1d4ed8" flood-opacity="0.12"/></filter></defs><rect width="100%" height="100%" fill="#f8fafc"/><g filter="url(#shadow)">${links.join('')}${nodes.join('')}</g></svg>`
}

function collectSourceRefs(args: any): string[] {
  const input = args?.sourceRefs || args?.sourceRef || args?.refs || args?.ref || args?.fileRef || args?.fileId
  const values = Array.isArray(input) ? input : input ? [input] : []
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean).map((value) => value.startsWith('file:') ? value : /^file_[0-9a-f-]+$/i.test(value) ? `file:${value}` : value))].slice(0, 10)
}

function renderHtml(title: string, svg: string, meta: { count: number; depth: number }, sourceRefs: string[] = []) {
  const sourceMeta = sourceRefs.length ? `<div class="sources">源文件：${sourceRefs.map(escapeHtml).join('、')}</div>` : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(title)}</title><style>html,body{margin:0;height:100%;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827}.wrap{min-height:100%;box-sizing:border-box;padding:16px}.card{height:calc(100vh - 32px);min-height:320px;overflow:auto;border:1px solid #dbeafe;border-radius:18px;background:white;box-shadow:0 18px 45px rgba(37,99,235,.12)}header{position:sticky;top:0;z-index:1;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e5e7eb;background:rgba(255,255,255,.92);backdrop-filter:blur(8px)}h1{margin:0;font-size:16px}.meta,.sources{font-size:12px;color:#6b7280}.sources{padding:0 16px 10px}.canvas{padding:10px;min-width:max-content}.canvas svg{max-width:none;height:auto}</style></head><body><div class="wrap"><div class="card"><header><h1>${escapeHtml(title)}</h1><div class="meta">${meta.count} 节点 · ${meta.depth + 1} 层</div></header>${sourceMeta}<div class="canvas">${svg}</div></div></div></body></html>`
}

export class MindmapArtifactService {
  create(roomId: string, args: any = {}): MindmapPreview {
    const title = text(args.title || args.topic || args.name, '脑图')
    const root = args.root || args.mindmap || args.node
      ? nodeFromInput(args.root || args.mindmap || args.node, title)
      : args.outline || args.markdown || args.outlineMarkdown
        ? outlineToNode(String(args.outline || args.markdown || args.outlineMarkdown), title)
        : Array.isArray(args.topics)
          ? fromFlatTopics(title, args.topics)
          : makeNode(title, [makeNode('背景'), makeNode('目标'), makeNode('关键步骤'), makeNode('后续行动')])
    const meta = measure(root)
    const sourceRefs = collectSourceRefs(args)
    const svg = renderSvg(root, title)
    const html = renderHtml(title, svg, meta, sourceRefs)
    const now = Date.now()
    return { id: `mindmap_${uuidv4()}`, roomId, title, root, svg, html, storage: svg.length <= INLINE_SVG_LIMIT ? 'inline' : 'tmp', sourceRefs, createdAt: now, expiresAt: now + TMP_TTL_MS }
  }

  async createPreview(roomId: string, args: any = {}) {
    const preview = this.create(roomId, args)
    const base = join(config.workspace.root, roomId, 'tmp', 'artifacts', 'mindmaps', preview.id)
    if (preview.storage === 'tmp' || args.tmp === true) {
      await mkdir(base, { recursive: true })
      await writeFile(join(base, 'index.html'), preview.html, 'utf8')
      await writeFile(join(base, 'preview.svg'), preview.svg, 'utf8')
      await writeFile(join(base, 'mindmap.json'), JSON.stringify({ title: preview.title, root: preview.root, sourceRefs: preview.sourceRefs || [], createdAt: preview.createdAt }, null, 2), 'utf8')
      preview.tmpPath = `tmp/artifacts/mindmaps/${preview.id}`
      preview.storage = 'tmp'
    }
    return preview
  }

  async renderTmp(roomId: string, previewId: string, file = 'index.html') {
    const safeId = String(previewId || '').replace(/[^a-zA-Z0-9_-]/g, '')
    const safeFile = ['index.html', 'preview.svg', 'mindmap.json'].includes(file) ? file : 'index.html'
    if (!safeId) throw { code: 'VALIDATION_ERROR', message: 'previewId is required' }
    return readFile(join(config.workspace.root, roomId, 'tmp', 'artifacts', 'mindmaps', safeId, safeFile), 'utf8')
  }

  async save(roomId: string, actorUserId: string, args: any = {}) {
    let title = text(args.title || args.name, '脑图')
    let html = String(args.html || '')
    let svg = String(args.svg || '')
    let root = args.root || args.mindmap || args.node
    let sourceRefs = collectSourceRefs(args)
    const previewId = text(args.previewId || args.id)
    if (previewId) {
      const base = join(config.workspace.root, roomId, 'tmp', 'artifacts', 'mindmaps', previewId.replace(/[^a-zA-Z0-9_-]/g, ''))
      try {
        const source = JSON.parse(await readFile(join(base, 'mindmap.json'), 'utf8'))
        title = text(args.title || source.title, title)
        root = source.root
        sourceRefs = Array.isArray(source.sourceRefs) ? source.sourceRefs : sourceRefs
        html = await readFile(join(base, 'index.html'), 'utf8')
        svg = await readFile(join(base, 'preview.svg'), 'utf8')
      } catch (err: any) {
        if (!html || !svg) throw err
      }
    }
    if (!html || !svg) {
      const preview = await this.createPreview(roomId, args)
      title = preview.title
      root = preview.root
      sourceRefs = preview.sourceRefs || sourceRefs
      html = preview.html
      svg = preview.svg
    }
    const relBase = safeRelativePath(args.targetDir || `mindmaps/${slug(title)}-${Date.now()}`)
    const filesRoot = join(config.workspace.root, roomId, 'files', relBase)
    await mkdir(filesRoot, { recursive: true })
    const json = JSON.stringify({ title, root, sourceRefs, savedAt: Date.now() }, null, 2)
    await writeFile(join(filesRoot, 'index.html'), html, 'utf8')
    await writeFile(join(filesRoot, 'preview.svg'), svg, 'utf8')
    await writeFile(join(filesRoot, 'mindmap.json'), json, 'utf8')
    const htmlInfo = await stat(join(filesRoot, 'index.html'))
    const svgInfo = await stat(join(filesRoot, 'preview.svg'))
    const jsonInfo = await stat(join(filesRoot, 'mindmap.json'))
    const folderId = roomFileService.ensureFolder(roomId, relBase, 'project', actorUserId)
    const htmlFile = roomFileService.upsertFileRecord({ roomId, folderId, name: 'index.html', rel: `${relBase}/index.html`, storagePath: `${relBase}/index.html`, mimeType: 'text/html', size: htmlInfo.size, source: 'mindmap_generated', uploadedBy: actorUserId })
    const svgFile = roomFileService.upsertFileRecord({ roomId, folderId, name: 'preview.svg', rel: `${relBase}/preview.svg`, storagePath: `${relBase}/preview.svg`, mimeType: 'image/svg+xml', size: svgInfo.size, source: 'mindmap_generated', uploadedBy: actorUserId })
    const jsonFile = roomFileService.upsertFileRecord({ roomId, folderId, name: 'mindmap.json', rel: `${relBase}/mindmap.json`, storagePath: `${relBase}/mindmap.json`, mimeType: 'application/json', size: jsonInfo.size, source: 'mindmap_generated', uploadedBy: actorUserId })
    return { title, directory: relBase, files: { html: htmlFile, svg: svgFile, json: jsonFile }, entryFile: htmlFile, filename: basename(relBase) }
  }
}

export const mindmapArtifactService = new MindmapArtifactService()
