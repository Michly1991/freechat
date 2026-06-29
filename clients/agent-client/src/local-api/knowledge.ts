import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, join, normalize } from 'path'
import { loadConfig } from '../config/store.js'
import { agentKnowledgeDir } from '../config/workspace.js'

export function agentBaseDir(agentId: string) {
  const cfg = loadConfig()
  const localAgent = cfg.agents.find((agent) => agent.agentId === agentId)
  return agentKnowledgeDir(localAgent || agentId)
}

export function knowledgeDir(agentId: string) {
  return agentBaseDir(agentId)
}

function safeName(name: string) {
  const clean = basename(name || '').replace(/[\x00-\x1f]/g, '').trim()
  if (!clean || clean === '.' || clean === '..') throw new Error('非法文件名')
  return clean
}

function walk(dir: string, rel = ''): any[] {
  if (!existsSync(dir)) return []
  const out: any[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    const full = join(dir, entry.name)
    const stat = statSync(full)
    if (entry.isDirectory()) out.push({ name: entry.name, path: childRel, type: 'dir', size: 0, updatedAt: stat.mtimeMs })
    else out.push({ name: entry.name, path: childRel, type: 'file', size: stat.size, updatedAt: stat.mtimeMs })
  }
  return out.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1)
}

export function listKnowledge(agentId: string) {
  const dir = knowledgeDir(agentId)
  mkdirSync(dir, { recursive: true })
  const files = walk(dir)
  const fileCount = files.filter((item) => item.type === 'file').length
  const totalSize = files.reduce((sum, item) => sum + (item.type === 'file' ? item.size : 0), 0)
  let updatedAt = 0
  try { updatedAt = statSync(dir).mtimeMs } catch {}
  return { agentId, dir, fileCount, totalSize, updatedAt, files }
}

export function putKnowledgeFile(agentId: string, name: string, content: string, encoding = 'utf8') {
  const dir = knowledgeDir(agentId)
  mkdirSync(dir, { recursive: true })
  const filename = safeName(name)
  const full = join(dir, filename)
  writeFileSync(full, encoding === 'base64' ? Buffer.from(content, 'base64') : content, encoding === 'base64' ? undefined : 'utf8')
  return { file: walk(dir).find((item) => item.path === filename), summary: listKnowledge(agentId) }
}

export function deleteKnowledgeFile(agentId: string, path: string) {
  const dir = knowledgeDir(agentId)
  const target = normalize(join(dir, path || ''))
  if (!target.startsWith(normalize(dir))) throw new Error('非法路径')
  if (existsSync(target)) rmSync(target, { force: true, recursive: false })
  return listKnowledge(agentId)
}

export function reindexKnowledge(agentId: string) {
  const summary = listKnowledge(agentId)
  const indexPath = join(knowledgeDir(agentId), '.freechat-knowledge-index.json')
  const index = { agentId, updatedAt: Date.now(), files: summary.files.filter((item) => item.type === 'file') }
  writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8')
  return { ...summary, index }
}
