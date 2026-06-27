import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-agent-knowledge-upload-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')
process.env.AGENT_RUNTIME_MODE = 'disabled'

const { default: db, initDatabase } = await import('../storage/db.js')
const { registerAgentKnowledgeRoutes } = await import('../routes/agent-knowledge.js')
const Fastify = (await import('fastify')).default
const multipart = (await import('@fastify/multipart')).default

const now = Date.now()
try {
  initDatabase()
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('owner', 'owner', 'x', 'Owner', 'user', 'human', now, now)
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('viewer', 'viewer', 'x', 'Viewer', 'user', 'human', now, now)
  db.prepare('INSERT INTO agents (id, owner_id, name, role_type, deployment, description, specialties, config, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('agent1', 'owner', 'Agent', 'assistant', 'client', null, null, '{}', 'active', now, now)

  const app = Fastify({ logger: false })
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 } })
  app.addHook('preHandler', async (request) => { (request as any).user = { id: 'owner', username: 'owner', nickname: 'Owner', role: 'user' } })
  registerAgentKnowledgeRoutes(app)

  const form = new FormData()
  form.append('path', 'docs/uploaded.md')
  form.append('file', new File([Buffer.from('# Uploaded\n\nhello knowledge')], 'source.md', { type: 'text/markdown' }))
  const res = await app.inject({ method: 'POST', url: '/api/agents/agent1/knowledge/files/upload', body: form as any })
  assert.equal(res.statusCode, 201, res.body)
  const data = res.json().data
  assert.equal(data.file.path, 'docs/uploaded.md')
  assert.equal(data.file.content, '# Uploaded\n\nhello knowledge')
  assert.equal(data.knowledge.files.length, 1)
  assert.equal((db.prepare('SELECT status FROM agent_knowledge_indexes WHERE agent_id = ?').get('agent1') as any)?.status, 'stale')

  const overwrite = new FormData()
  overwrite.append('path', 'docs/uploaded.md')
  overwrite.append('file', new File([Buffer.from('updated')], 'uploaded.md', { type: 'text/markdown' }))
  const overwriteRes = await app.inject({ method: 'POST', url: '/api/agents/agent1/knowledge/files/upload', body: overwrite as any })
  assert.equal(overwriteRes.statusCode, 201, overwriteRes.body)
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_knowledge_files WHERE agent_id = ? AND deleted_at IS NULL').get('agent1') as any)?.count, 1)
  assert.equal(overwriteRes.json().data.file.content, 'updated')

  const binary = new FormData()
  binary.append('file', new File([Buffer.from([0, 1, 2, 3])], 'bad.pdf', { type: 'application/pdf' }))
  const badRes = await app.inject({ method: 'POST', url: '/api/agents/agent1/knowledge/files/upload', body: binary as any })
  assert.equal(badRes.statusCode, 400, badRes.body)

  await app.close()
  console.log('agent knowledge upload smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
