import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-mindmap-skill-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { agentService } = await import('../services/agent.service.js')
const { executeAppAction } = await import('../app-actions/executor.js')
const { executeInlineToolCalls } = await import('../services/inline-agent-tool.service.js')
const { mindmapArtifactService } = await import('../services/mindmap-artifact.service.js')
const { messageService } = await import('../services/message.service.js')

const now = Date.now()

try {
  initDatabase()
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'x', 'Owner', 'user', 'human', now, now)
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('room', 'Room', 'owner', now, now, now)
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)')
    .run('room', 'owner', 'owner', 'human', now)
  const created = await agentService.createAgent('owner', { name: '小蜜', roleType: 'assistant', deployment: 'server', description: 'assistant', specialties: [], config: { builtInKey: 'xiaomi_assistant' } as any })
  await agentService.addAgentToRoom('room', created.agent.id, 'owner', { roomRole: 'assistant', autoEnabled: true })
  const ctx = { roomId: 'room', agentId: created.agent.id, actorUserId: 'owner' }

  const previewResult = await executeAppAction(ctx, 'mindmap.create', { title: 'FreeChat 脑图', outline: '# FreeChat\n- Server\n  - App Actions\n- Web\n  - Chat Artifact', sourceRefs: ['file:source_xlsx'] })
  const preview = previewResult.response?.data.preview
  assert.equal(previewResult.response?.success, true)
  assert.match(preview.svg, /<svg/)
  assert.match(preview.html, /FreeChat 脑图/)
  assert.deepEqual(preview.sourceRefs, ['file:source_xlsx'])
  assert.match(preview.html, /file:source_xlsx/)
  assert.equal(existsSync(join(process.env.WORKSPACE_ROOT!, 'room', 'files', 'mindmaps')), false, 'preview should not create formal files')

  const savedResult = await executeAppAction(ctx, 'mindmap.save', { previewId: preview.id, html: preview.html, svg: preview.svg, root: preview.root, title: preview.title, sourceRefs: preview.sourceRefs, targetDir: 'mindmaps/freechat-demo' })
  assert.equal(savedResult.response?.success, true)
  assert.equal(existsSync(join(process.env.WORKSPACE_ROOT!, 'room', 'files', 'mindmaps/freechat-demo/index.html')), true)

  const inline = await executeInlineToolCalls('room', created.agent.id, 'owner', '<toolcall>{"name":"mindmap.create","args":{"title":"内联脑图","outline":"# 内联脑图\\n- A\\n- B"}}</toolcall>')
  assert.match(inline || '', /已生成脑图预览/)
  const messages = await messageService.getMessages('room', 10)
  assert.ok(messages.some((msg: any) => msg.kind === 'artifact_preview' && msg.payload?.artifactType === 'mindmap'))

  const rendered = await mindmapArtifactService.renderTmp('room', preview.id).catch(() => '')
  assert.equal(rendered, '', 'small inline previews do not need tmp render files')
  console.log('mindmap skill smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
