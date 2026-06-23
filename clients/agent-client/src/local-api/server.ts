import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { loadConfig, removeAgent, saveConfig, updateAgent, upsertAgent, workRoot } from '../config/store.js'
import { pairAgent as pairAgentRemote } from '../connector/api.js'
import { createPairingCode, createServerAgent, getServerMe, listManagedRooms, listServerAgents, loginServer, testServer, updateServerAgent } from '../connector/server-admin.js'
import { healthSnapshot } from '../health/checks.js'
import { runtimeState, startWorker, stopWorker } from '../worker/runtime.js'
import { renderConsoleHtml } from './web.js'
import { deleteKnowledgeFile, listKnowledge, putKnowledgeFile, reindexKnowledge } from './knowledge.js'

const sessions = new Set<string>()

function json(res: ServerResponse, status: number, data: any) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(data))
}

async function readBody(req: IncomingMessage) {
  let body = ''
  for await (const chunk of req) body += chunk
  return body ? JSON.parse(body) : {}
}

function cookie(req: IncomingMessage, name: string) {
  const raw = req.headers.cookie || ''
  return raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`))?.slice(name.length + 1)
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

function requireAuth(req: IncomingMessage, res: ServerResponse) {
  const cfg = loadConfig()
  if (!cfg.adminPassword && cfg.host === '127.0.0.1') return true
  const token = cookie(req, 'fcac_session') || String(req.headers['x-agent-client-session'] || '')
  if (token && sessions.has(token)) return true
  json(res, 401, { success: false, error: { code: 'UNAUTHORIZED', message: '请先登录客户端控制台' } })
  return false
}

function summarizeStore(label: string, kind: string, path: string) {
  if (!existsSync(path)) return { label, kind, path, exists: false, fileCount: 0, dirCount: 0, entries: [] }
  const entries = readdirSync(path, { withFileTypes: true }).slice(0, 20).map((entry) => ({ name: entry.name, type: entry.isDirectory() ? 'dir' : 'file' }))
  const all = readdirSync(path, { withFileTypes: true })
  let updatedAt = 0
  try { updatedAt = statSync(path).mtimeMs } catch {}
  return {
    label,
    kind,
    path,
    exists: true,
    fileCount: all.filter((entry) => entry.isFile()).length,
    dirCount: all.filter((entry) => entry.isDirectory()).length,
    updatedAt,
    entries,
  }
}

function agentKnowledgeSummary(agentId: string) {
  const cfg = loadConfig()
  const localAgent = cfg.agents.find((agent) => agent.agentId === agentId)
  const base = localAgent?.workdir || join(workRoot(), agentId)
  return {
    agentId,
    localAgent: localAgent ? { agentId: localAgent.agentId, name: localAgent.name, enabled: localAgent.enabled, status: localAgent.status } : null,
    stores: [
      summarizeStore('Agent 客户端知识库', 'knowledge', join(base, 'knowledge')),
      summarizeStore('Agent 工作区', 'workspace', base),
      summarizeStore('运行规范缓存', 'runtime', join(base, '.freechat')),
    ],
  }
}

export function startLocalServer() {
  const cfg = loadConfig()
  if (cfg.host === '0.0.0.0' && !cfg.adminPassword) {
    throw new Error('公网监听 AGENT_CLIENT_HOST=0.0.0.0 时必须配置 AGENT_CLIENT_ADMIN_PASSWORD')
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(renderConsoleHtml()); return
      }
      if (!url.pathname.startsWith('/api/local')) { json(res, 404, { success: false, error: { code: 'NOT_FOUND' } }); return }
      const path = url.pathname.slice('/api/local'.length) || '/'
      if (path === '/login' && req.method === 'POST') {
        const body = await readBody(req); const latest = loadConfig()
        if (!latest.adminPassword || !safeEqual(String(body.password || ''), latest.adminPassword)) throw new Error('管理员密码错误')
        const token = randomBytes(24).toString('base64url'); sessions.add(token)
        res.setHeader('set-cookie', `fcac_session=${token}; HttpOnly; SameSite=Lax; Path=/`)
        json(res, 200, { success: true, data: { ok: true, sessionToken: token } }); return
      }
      if (path === '/logout' && req.method === 'POST') { const token = cookie(req, 'fcac_session'); if (token) sessions.delete(token); json(res, 200, { success: true }); return }
      if (!requireAuth(req, res)) return
      if (path === '/session') { json(res, 200, { success: true, data: { ok: true } }); return }
      if (path === '/state') { const current = loadConfig(); json(res, 200, { success: true, data: { config: { ...current, adminPassword: current.adminPassword ? 'configured' : undefined, serverPassword: current.serverPassword ? 'configured' : undefined, serverAuthToken: current.serverAuthToken ? 'configured' : undefined, agents: current.agents.map((a) => ({ ...a, accessToken: undefined, connectorToken: undefined })) }, runtime: runtimeState } }); return }
      if (path === '/health') { json(res, 200, { success: true, data: healthSnapshot() }); return }

      if (path === '/config' && req.method === 'PATCH') {
        const body = await readBody(req); const current = loadConfig()
        const next = { ...current }
        if (typeof body.serverUrl === 'string' && body.serverUrl.trim()) next.serverUrl = body.serverUrl.trim().replace(/\/+$/, '')
        if (typeof body.clientName === 'string') next.clientName = body.clientName.trim() || current.clientName
        if (typeof body.adminPassword === 'string' && body.adminPassword.trim()) next.adminPassword = body.adminPassword.trim()
        if (typeof body.serverUsername === 'string') next.serverUsername = body.serverUsername.trim() || undefined
        if (typeof body.serverPassword === 'string' && body.serverPassword.trim()) next.serverPassword = body.serverPassword.trim()
        if (body.maxConcurrency !== undefined) next.maxConcurrency = Math.max(1, Number(body.maxConcurrency) || current.maxConcurrency)
        if (body.pollIntervalMs !== undefined) next.pollIntervalMs = Math.max(1000, Number(body.pollIntervalMs) || current.pollIntervalMs)
        saveConfig(next); json(res, 200, { success: true, data: { ok: true } }); return
      }

      if (path === '/server/auto-login' && req.method === 'POST') {
        const current = loadConfig()
        if (!current.serverUsername || !current.serverPassword) throw new Error('请先保存 FreeChat 账号和密码')
        const result = await loginServer(current.serverUrl, current.serverUsername, current.serverPassword)
        const token = result.token || result.accessToken || result.jwt || result?.user?.token
        if (!token) throw new Error('服务端登录成功但未返回 token')
        saveConfig({ ...current, serverAuthToken: token, serverUser: result.user || null })
        json(res, 200, { success: true, data: { user: result.user || null } }); return
      }
      if (path === '/server/test' && req.method === 'POST') {
        const body = await readBody(req); const current = loadConfig()
        const serverUrl = String(body.serverUrl || current.serverUrl).trim().replace(/\/+$/, '')
        json(res, 200, { success: true, data: await testServer(serverUrl) }); return
      }
      if (path === '/server/login' && req.method === 'POST') {
        const body = await readBody(req); const current = loadConfig()
        const serverUrl = String(body.serverUrl || current.serverUrl).trim().replace(/\/+$/, '')
        const result = await loginServer(serverUrl, String(body.username || ''), String(body.password || ''))
        const token = result.token || result.accessToken || result.jwt || result?.user?.token
        if (!token) throw new Error('服务端登录成功但未返回 token')
        saveConfig({ ...current, serverUrl, serverUsername: String(body.username || ''), serverPassword: String(body.password || ''), serverAuthToken: token, serverUser: result.user || null })
        json(res, 200, { success: true, data: { user: result.user || null } }); return
      }
      if (path === '/server/logout' && req.method === 'POST') {
        const current = loadConfig(); saveConfig({ ...current, serverAuthToken: undefined, serverUser: undefined })
        json(res, 200, { success: true }); return
      }
      if (path === '/server/clear-account' && req.method === 'POST') {
        const current = loadConfig(); saveConfig({ ...current, serverAuthToken: undefined, serverUser: undefined, serverUsername: undefined, serverPassword: undefined })
        json(res, 200, { success: true }); return
      }
      if (path === '/server/me') { json(res, 200, { success: true, data: await getServerMe(loadConfig()) }); return }
      if (path === '/server/agents' && req.method === 'GET') {
        const agents = (await listServerAgents(loadConfig())).filter((agent: any) => agent.isOwner === true)
        json(res, 200, { success: true, data: { agents } }); return
      }
      if (path === '/server/managed-rooms' && req.method === 'GET') {
        json(res, 200, { success: true, data: { rooms: await listManagedRooms(loadConfig()) } }); return
      }
      if (path === '/server/agents' && req.method === 'POST') {
        const body = await readBody(req); json(res, 200, { success: true, data: await createServerAgent(loadConfig(), body) }); return
      }
      const serverAgentPatch = path.match(/^\/server\/agents\/([^/]+)$/)
      if (serverAgentPatch && req.method === 'PATCH') {
        const body = await readBody(req); json(res, 200, { success: true, data: await updateServerAgent(loadConfig(), decodeURIComponent(serverAgentPatch[1]), body) }); return
      }
      const bindAgent = path.match(/^\/server\/agents\/([^/]+)\/bind$/)
      if (bindAgent && req.method === 'POST') {
        const current = loadConfig(); const agentId = decodeURIComponent(bindAgent[1])
        const agents = (await listServerAgents(current)).filter((agent: any) => agent.isOwner === true)
        const target = agents.find((agent: any) => agent.id === agentId)
        if (!target) throw new Error('只能同步或接管当前账号自己发布的 Agent')
        const pairing = await createPairingCode(current, agentId)
        const agent = await pairAgentRemote(current, pairing.code, current.clientName)
        upsertAgent(agent); json(res, 200, { success: true, data: { agent: { ...agent, accessToken: undefined, connectorToken: undefined } } }); return
      }
      if (path === '/agents/pair' && req.method === 'POST') { const body = await readBody(req); const agent = await pairAgentRemote(loadConfig(), body.pairingCode, body.name); upsertAgent(agent); json(res, 200, { success: true, data: { ...agent, accessToken: undefined, connectorToken: undefined } }); return }
      const agentKnowledge = path.match(/^\/agents\/([^/]+)\/knowledge$/)
      if (agentKnowledge && req.method === 'GET') {
        const agentId = decodeURIComponent(agentKnowledge[1])
        json(res, 200, { success: true, data: { ...agentKnowledgeSummary(agentId), knowledge: listKnowledge(agentId) } }); return
      }
      if (agentKnowledge && req.method === 'POST') {
        const body = await readBody(req); const agentId = decodeURIComponent(agentKnowledge[1])
        json(res, 200, { success: true, data: putKnowledgeFile(agentId, body.name, body.content || '', body.encoding || 'utf8') }); return
      }
      const agentKnowledgeReindex = path.match(/^\/agents\/([^/]+)\/knowledge\/reindex$/)
      if (agentKnowledgeReindex && req.method === 'POST') { json(res, 200, { success: true, data: reindexKnowledge(decodeURIComponent(agentKnowledgeReindex[1])) }); return }
      const agentKnowledgeFile = path.match(/^\/agents\/([^/]+)\/knowledge\/files\/(.+)$/)
      if (agentKnowledgeFile && req.method === 'DELETE') { json(res, 200, { success: true, data: deleteKnowledgeFile(decodeURIComponent(agentKnowledgeFile[1]), decodeURIComponent(agentKnowledgeFile[2])) }); return }
      const agentPatch = path.match(/^\/agents\/([^/]+)$/)
      if (agentPatch && req.method === 'PATCH') { const body = await readBody(req); const agent = updateAgent(decodeURIComponent(agentPatch[1]), body); json(res, 200, { success: true, data: { ...agent, accessToken: undefined, connectorToken: undefined } }); return }
      if (agentPatch && req.method === 'DELETE') { removeAgent(decodeURIComponent(agentPatch[1])); json(res, 200, { success: true }); return }
      if (path === '/worker/start' && req.method === 'POST') { void startWorker(); json(res, 200, { success: true }); return }
      if (path === '/worker/stop' && req.method === 'POST') { stopWorker(); json(res, 200, { success: true }); return }
      json(res, 404, { success: false, error: { code: 'NOT_FOUND' } })
    } catch (err: any) {
      json(res, 500, { success: false, error: { code: 'CLIENT_ERROR', message: err?.message || String(err) } })
    }
  })
  server.listen(cfg.port, cfg.host, () => {
    console.log(`Agent Client console listening on http://${cfg.host}:${cfg.port}`)
    if (cfg.host === '0.0.0.0') console.log('Public mode enabled. Use HTTPS reverse proxy and a strong admin password.')
  })
  return server
}
