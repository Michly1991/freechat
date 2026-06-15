import { copyFile, mkdir, stat } from 'fs/promises'
import { dirname, join, normalize } from 'path'
import { config } from '../config.js'
import { tabConfigService } from './tab-config.service.js'

function safeArtifactPath(input = ''): string | null {
  const trimmed = String(input || '').trim().replace(/^`|`$/g, '').replace(/^[/\\]+/, '')
  if (!trimmed) return null
  const cleaned = normalize(trimmed).replace(/^([/\\])+/, '').replace(/\\/g, '/')
  if (!cleaned || cleaned === '.' || cleaned.startsWith('..') || cleaned.includes('../')) return null
  return cleaned
}

function extractArtifactPaths(prompt: string): string[] {
  const paths = new Set<string>()
  const text = String(prompt || '')
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/(?:产物路径|文件路径|项目文件路径|artifactPath)\s*[:：]\s*(.+)$/i)
    if (!match) continue
    const path = safeArtifactPath(match[1].trim())
    if (path) paths.add(path)
  }
  return Array.from(paths)
}

export class AgentArtifactService {
  async publishDeclaredArtifacts(roomId: string, agentId: string, prompt: string): Promise<string[]> {
    const paths = extractArtifactPaths(prompt)
    const published: string[] = []
    for (const rel of paths) {
      const source = join(config.workspace.root, roomId, 'agents', agentId, rel)
      const target = join(config.workspace.root, roomId, 'files', rel)
      try {
        const info = await stat(source)
        if (!info.isFile()) continue
        await mkdir(dirname(target), { recursive: true })
        await copyFile(source, target)
        await tabConfigService.addFile(roomId, 'files', rel)
        published.push(rel)
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err
      }
    }
    return published
  }
}

export const agentArtifactService = new AgentArtifactService()
