import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-client-file-skills-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { agentService } = await import('../services/agent.service.js')
const { executeAppAction } = await import('../app-actions/executor.js')
const { executeTool } = await import('../app-actions/router.js')

const now = Date.now()
try {
  initDatabase()
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'x', 'Owner', 'user', 'human', now, now)
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('room', 'Room', 'owner', now, now, now)
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run('room', 'owner', 'owner', 'human', now)
  const created = await agentService.createAgent('owner', { name: '小蜜', roleType: 'assistant', deployment: 'client', description: 'assistant', specialties: [], config: {} as any })
  await agentService.addAgentToRoom('room', created.agent.id, 'owner', { roomRole: 'assistant', autoEnabled: true })
  const ctx = { roomId: 'room', agentId: created.agent.id, actorUserId: 'owner' }

  const roomFilesDir = join(process.env.WORKSPACE_ROOT!, 'room', 'files', 'docs')
  await mkdir(roomFilesDir, { recursive: true })
  await writeFile(join(roomFilesDir, 'note.md'), '# Note\nhello text', 'utf8')

  const readText = await executeAppAction(ctx, 'file.read', { path: 'docs/note.md' })
  assert.equal(readText.response?.success, true)
  assert.match(readText.response?.data?.content || '', /hello text/)

  for (const action of ['pdf.read', 'excel.read', 'word.read', 'ppt.read', 'image.read', 'excel.write', 'word.write', 'ppt.write']) {
    await assert.rejects(
      executeAppAction(ctx, action, { ref: 'file:any', targetPath: 'out.bin' }),
      (err: any) => err?.code === 'CLIENT_FILE_PROCESSING_REQUIRED'
    )
    const schema = await executeAppAction(ctx, 'tool.schema', { action })
    assert.equal(schema.response?.data?.tool?.risk, 'blocked')
  }

  await assert.rejects(
    executeTool({ ...ctx, action: 'excel.read', args: { ref: 'file:any' }, transport: 'test' } as any, { audit: false }),
    (err: any) => err?.code === 'TOOL_BLOCKED'
  )

  const runtime = await import('../services/agent-runtime-spec.service.js').then((m) => m.agentRuntimeSpecService.getSpec())
  assert.match(runtime.runtimeRules, /服务端只提供文件上传、下载、存储、权限和审计基础能力/)
  assert.match(runtime.runtimeRules, /file download file:<fileId>/)
  assert.match(runtime.runtimeRules, /res\/downloads/)

  const skillRoot = join(temp, 'skills')
  const { agentPackageService } = await import('../services/agent-package.service.js')
  await agentPackageService.mountSystemSkills(skillRoot)
  const excelSkill = await readFile(join(skillRoot, 'excel-reader', 'SKILL.md'), 'utf8')
  assert.match(excelSkill, /file download file:<fileId> res\/downloads\/<filename>/)
  assert.match(excelSkill, /服务端解析复杂文件/)

  console.log('client file processing boundary smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
