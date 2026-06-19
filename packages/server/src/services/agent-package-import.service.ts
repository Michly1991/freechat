import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { existsSync } from 'fs'
import { mkdtemp, mkdir, readFile, rm, cp, readdir } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { pipeline } from 'stream/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { v4 as uuidv4 } from 'uuid'
import db from '../storage/db.js'
import { agentService } from './agent.service.js'
import { agentCapabilityService } from './agent-capability.service.js'
import { agentPackageService } from './agent-package.service.js'

const execFileAsync = promisify(execFile)
const MAX_PACKAGE_BYTES = 50 * 1024 * 1024

function safeName(value: string) {
  return String(value || 'item').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'item'
}

function assertSafeTarEntry(entry: string) {
  if (!entry || entry.startsWith('/') || entry.includes('..') || entry.includes('\\')) throw { code: 'INVALID_AGENT_PACKAGE', message: `Unsafe package path: ${entry}` }
  if (!entry.startsWith('package/')) throw { code: 'INVALID_AGENT_PACKAGE', message: 'npm tgz must contain package/ prefix' }
}

function versionCompare(a: string, b: string) {
  const pa = String(a || '0').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  const pb = String(b || '0').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

async function copyAllowed(source: string, target: string) {
  if (!existsSync(source)) return
  await cp(source, target, {
    recursive: true,
    force: true,
    filter: (src) => {
      const name = basename(src)
      if (['node_modules', '.git', '.npmrc', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].includes(name)) return false
      return true
    }
  })
}

async function readSkillPackages(skillsDir: string) {
  if (!existsSync(skillsDir)) return []
  const items = await readdir(skillsDir, { withFileTypes: true })
  const skills: Array<{ name: string; content: string }> = []
  for (const item of items) {
    if (!item.isDirectory()) continue
    const dir = join(skillsDir, item.name)
    const skillMd = join(dir, 'SKILL.md')
    if (!existsSync(skillMd)) throw { code: 'INVALID_AGENT_PACKAGE', message: `Skill ${item.name} missing SKILL.md` }
    skills.push({ name: item.name, content: await readFile(skillMd, 'utf8') })
  }
  return skills
}

export class AgentPackageImportService {
  async importFromMultipartFile(userId: string, file: any) {
    if (!file) throw { code: 'VALIDATION_ERROR', message: 'package file is required' }
    const filename = String(file.filename || '')
    if (!filename.endsWith('.tgz') && !filename.endsWith('.tar.gz')) throw { code: 'VALIDATION_ERROR', message: 'Only npm tgz package is supported' }
    const tmpRoot = await mkdtemp(join(tmpdir(), 'freechat-agent-package-'))
    const archive = join(tmpRoot, 'agent.tgz')
    try {
      const hash = createHash('sha256')
      let size = 0
      file.file.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_PACKAGE_BYTES) file.file.destroy(new Error('PACKAGE_TOO_LARGE'))
        hash.update(chunk)
      })
      await pipeline(file.file, createWriteStream(archive))
      const checksum = hash.digest('hex')
      return await this.importArchive(userId, archive, checksum)
    } catch (err: any) {
      if (err?.message === 'PACKAGE_TOO_LARGE') throw { code: 'PACKAGE_TOO_LARGE', message: 'Agent package exceeds 50MB limit' }
      throw err
    } finally {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
    }
  }

  async importArchive(userId: string, archivePath: string, checksum?: string) {
    const list = (await execFileAsync('tar', ['-tzf', archivePath], { maxBuffer: 1024 * 1024 * 5 })).stdout.split('\n').filter(Boolean)
    for (const entry of list) assertSafeTarEntry(entry)
    const tmpRoot = await mkdtemp(join(tmpdir(), 'freechat-agent-extract-'))
    try {
      await execFileAsync('tar', ['-xzf', archivePath, '-C', tmpRoot], { maxBuffer: 1024 * 1024 * 5 })
      const packageDir = join(tmpRoot, 'package')
      return await this.importPackageDir(userId, packageDir, checksum || await this.checksumFile(archivePath))
    } finally {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
    }
  }

  async importPackageDir(userId: string, packageDir: string, checksum: string) {
    const manifestPath = join(packageDir, 'package.json')
    const agentMdPath = join(packageDir, 'AGENT.md')
    if (!existsSync(manifestPath)) throw { code: 'INVALID_AGENT_PACKAGE', message: 'package.json is required' }
    if (!existsSync(agentMdPath)) throw { code: 'INVALID_AGENT_PACKAGE', message: 'AGENT.md is required' }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (manifest?.freechat?.kind !== 'agent') throw { code: 'INVALID_AGENT_PACKAGE', message: 'package.json freechat.kind must be agent' }
    const agentMeta = manifest.freechat.agent || {}
    const name = String(agentMeta.name || manifest.freechat.name || manifest.name || '').trim()
    if (!name) throw { code: 'INVALID_AGENT_PACKAGE', message: 'freechat.agent.name is required' }
    const roleType = agentMeta.roleType === 'assistant' ? 'assistant' : 'specialist'
    const packageName = String(manifest.name || '').trim()
    const packageVersion = String(manifest.version || '0.0.0').trim()
    if (!packageName || !packageVersion) throw { code: 'INVALID_AGENT_PACKAGE', message: 'package name and version are required' }

    const skillsDirName = manifest.freechat.skillsDir || 'skills'
    const skillsDir = join(packageDir, skillsDirName)
    const skills = await readSkillPackages(skillsDir)
    const agentMarkdown = await readFile(agentMdPath, 'utf8')
    const existing = db.prepare('SELECT ap.*, a.id agent_id FROM agent_packages ap INNER JOIN agents a ON a.id = ap.agent_id WHERE ap.imported_by = ? AND ap.package_name = ?').get(userId, packageName) as any
    const mode = existing ? (versionCompare(packageVersion, existing.package_version) > 0 ? 'update' : versionCompare(packageVersion, existing.package_version) < 0 ? 'downgrade' : 'overwrite') : 'create'

    const config = {
      ...(agentMeta.config || {}),
      agentMarkdown,
      package: { name: packageName, version: packageVersion, checksum, importedAt: Date.now() },
      behavior: agentMeta.behavior || agentMeta.config?.behavior,
      tools: agentMeta.tools || agentMeta.config?.tools,
    }
    const specialties = Array.isArray(agentMeta.specialties) ? agentMeta.specialties.map(String) : []
    const description = String(agentMeta.description || manifest.description || '')
    const now = Date.now()
    let agentId = existing?.agent_id
    let agent: any
    if (!agentId) {
      const created = await agentService.createAgent(userId, { name, roleType, deployment: 'server', description, specialties, config } as any)
      agent = created.agent
      agentId = agent.id
    } else {
      db.prepare(`UPDATE agents SET name = ?, role_type = ?, description = ?, specialties = ?, config = ?, market_listed = 1, status = 'active', updated_at = ? WHERE id = ? AND owner_id = ?`).run(name, roleType, description || null, specialties.length ? JSON.stringify(specialties) : null, JSON.stringify(config), now, agentId, userId)
      db.prepare('DELETE FROM agent_skills WHERE agent_id = ?').run(agentId)
      db.prepare('DELETE FROM agent_scripts WHERE agent_id = ?').run(agentId)
      agent = await agentService.getAgent(agentId)
    }

    for (let i = 0; i < skills.length; i++) agentCapabilityService.createSkill(agentId, { name: skills[i].name, content: skills[i].content, enabled: true, sortOrder: i })

    const dest = agentPackageService.agentPackageDir(agentId)
    await rm(dest, { recursive: true, force: true }).catch(() => {})
    await mkdir(dest, { recursive: true })
    await copyAllowed(agentMdPath, join(dest, 'AGENT.md'))
    await copyAllowed(join(packageDir, manifest.freechat.resDir || 'res'), join(dest, 'res'))
    await copyAllowed(join(packageDir, manifest.freechat.scriptsDir || 'scripts'), join(dest, 'scripts'))
    await copyAllowed(skillsDir, join(dest, 'skills'))
    for (const required of ['res', 'scripts', 'skills']) await mkdir(join(dest, required), { recursive: true })

    db.prepare(`UPDATE agents SET market_listed = 1, updated_at = ? WHERE id = ? AND owner_id = ?`).run(now, agentId, userId)
    const recordId = existing?.id || `apkg_${uuidv4()}`
    db.prepare(`
      INSERT INTO agent_packages (id, agent_id, package_name, package_version, checksum, manifest_json, imported_by, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(imported_by, package_name) DO UPDATE SET
        agent_id = excluded.agent_id,
        package_version = excluded.package_version,
        checksum = excluded.checksum,
        manifest_json = excluded.manifest_json,
        imported_at = excluded.imported_at
    `).run(recordId, agentId, packageName, packageVersion, checksum, JSON.stringify(manifest), userId, now)
    await agentPackageService.ensureAgentPackage(await agentService.getAgent(agentId))
    return { mode, listed: true, agent: await agentService.getAgent(agentId), package: { name: packageName, version: packageVersion, checksum, skills: skills.map((s) => s.name) } }
  }

  async checksumFile(path: string) {
    const data = await readFile(path)
    return createHash('sha256').update(data).digest('hex')
  }
}

export const agentPackageImportService = new AgentPackageImportService()
