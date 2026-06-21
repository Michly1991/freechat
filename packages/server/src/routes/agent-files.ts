import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'fs'
import { mkdir, writeFile, stat } from 'fs/promises'
import { basename, dirname, join } from 'path'
import db from '../storage/db.js'
import { config } from '../config.js'
import { verifyAgentToolToken } from '../agent-tool-token.js'
import { agentService } from '../services/agent.service.js'
import { remoteAgentConnectorService } from '../services/remote-agent-connector.service.js'
import { tabConfigService } from '../services/tab-config.service.js'
import { tabFilesMapService } from '../services/tab-files-map.service.js'
import { broadcast, assertProjectFilePathAllowed, safeRelativePath } from './agent-tools.helpers.js'

async function authenticateAgentFileRequest(roomId: string, authorization?: string) {
  const auth = authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  let verified = verifyAgentToolToken(roomId, token)
  let remoteAuth: any = null
  if (!verified.ok || !verified.agentId) {
    remoteAuth = await remoteAgentConnectorService.authenticateBearer(authorization)
    if (remoteAuth) verified = { ok: true, agentId: remoteAuth.agentId, actorUserId: remoteAuth.ownerId }
  }
  if (!verified.ok || !verified.agentId) throw { status: 401, code: 'UNAUTHORIZED', message: 'Invalid agent file token' }
  const roomAgent = db.prepare('SELECT 1 FROM room_agents WHERE room_id = ? AND agent_id = ?').get(roomId, verified.agentId)
  if (!roomAgent) throw { status: 403, code: 'FORBIDDEN', message: 'Agent is not in this room' }
  const agent = await agentService.getAgent(verified.agentId)
  agentService.assertToolAllowed(agent, 'file.download')
  return { agent, actorUserId: verified.actorUserId || remoteAuth?.ownerId || agent.ownerId }
}

function cleanFilename(input = 'upload.bin') {
  return basename(input).replace(/[\\/:*?"<>|]/g, '_').trim() || 'upload.bin'
}

export async function registerAgentFileRoutes(app: FastifyInstance) {
  app.get('/api/agent-files/:roomId/download', async (request, reply) => {
    const { roomId } = request.params as any
    try {
      await authenticateAgentFileRequest(roomId, request.headers.authorization)
      const rel = safeRelativePath((request.query as any)?.path || '')
      const fullPath = join(config.workspace.root, roomId, 'files', rel)
      const info = await stat(fullPath)
      if (!info.isFile()) throw { status: 400, code: 'VALIDATION_ERROR', message: 'path is not a file' }
      return reply.header('content-disposition', `attachment; filename="${encodeURIComponent(basename(rel))}"`).send(createReadStream(fullPath))
    } catch (err: any) {
      return reply.code(err.status || (err.code === 'ENOENT' ? 404 : 500)).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.post('/api/agent-files/:roomId/upload', async (request, reply) => {
    const { roomId } = request.params as any
    try {
      await authenticateAgentFileRequest(roomId, request.headers.authorization)
      const file = await request.file()
      if (!file) throw { status: 400, code: 'VALIDATION_ERROR', message: 'No file uploaded' }
      const requestedPath = String((file.fields?.path as any)?.value || '').trim()
      const addToTab = String((file.fields?.addToTab as any)?.value || '').toLowerCase() === 'true'
      const rel = safeRelativePath(requestedPath || cleanFilename(file.filename))
      assertProjectFilePathAllowed(rel)
      const fullPath = join(config.workspace.root, roomId, 'files', rel)
      await mkdir(dirname(fullPath), { recursive: true })
      const buffer = await file.toBuffer()
      await writeFile(fullPath, buffer)
      if (addToTab) { await tabConfigService.addFile(roomId, 'files', rel); await tabFilesMapService.writeRoomMap(roomId) }
      broadcast(roomId, 'files.updated', { path: rel })
      return { success: true, data: { path: rel, name: cleanFilename(file.filename), size: buffer.length, mimeType: file.mimetype, addToTab } }
    } catch (err: any) {
      return reply.code(err.status || (err.code === 'INVALID_PATH' ? 400 : 500)).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })
}
