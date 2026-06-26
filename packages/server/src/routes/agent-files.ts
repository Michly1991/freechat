import type { FastifyInstance } from 'fastify'
import { basename } from 'path'
import db from '../storage/db.js'
import { verifyAgentToolToken } from '../agent-tool-token.js'
import { agentService } from '../services/agent.service.js'
import { remoteAgentConnectorService } from '../services/remote-agent-connector.service.js'
import { tabConfigService } from '../services/tab-config.service.js'
import { tabFilesMapService } from '../services/tab-files-map.service.js'
import { roomFileService } from '../services/room-file.service.js'
import { broadcast } from './agent-tools.helpers.js'
import { assertRoomMember } from './route-auth.js'

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
  const actorUserId = verified.actorUserId || remoteAuth?.ownerId
  if (!actorUserId) throw { status: 403, code: 'ACTOR_REQUIRED', message: 'Agent file operations require user-scoped actorUserId' }
  assertRoomMember(roomId, actorUserId)
  const roomAgent = db.prepare('SELECT 1 FROM room_agents WHERE room_id = ? AND agent_id = ?').get(roomId, verified.agentId)
  if (!roomAgent) throw { status: 403, code: 'FORBIDDEN', message: 'Agent is not in this room' }
  const agent = await agentService.getAgent(verified.agentId)
  agentService.assertToolAllowed(agent, 'file.download')
  return { agent, actorUserId }
}

function cleanFilename(input = 'upload.bin') {
  return basename(input).replace(/[\\/:*?"<>|]/g, '_').trim() || 'upload.bin'
}

export async function registerAgentFileRoutes(app: FastifyInstance) {
  app.get('/api/agent-files/:roomId/download', async (request, reply) => {
    const { roomId } = request.params as any
    try {
      await authenticateAgentFileRequest(roomId, request.headers.authorization)
      const raw = (request.query as any)?.ref || (request.query as any)?.path || ''
      const { row, stream } = roomFileService.streamForRef(roomId, raw)
      return reply.header('content-disposition', `attachment; filename="${encodeURIComponent(row.name || basename(row.relative_path))}"`).send(stream)
    } catch (err: any) {
      return reply.code(err.status || (err.code === 'ENOENT' ? 404 : 500)).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.post('/api/agent-files/:roomId/upload', async (request, reply) => {
    const { roomId } = request.params as any
    try {
      const auth = await authenticateAgentFileRequest(roomId, request.headers.authorization)
      const file = await request.file()
      if (!file) throw { status: 400, code: 'VALIDATION_ERROR', message: 'No file uploaded' }
      const requestedPath = String((file.fields?.path as any)?.value || '').trim()
      const addToTab = String((file.fields?.addToTab as any)?.value || '').toLowerCase() === 'true'
      const record = await roomFileService.uploadProjectFile(roomId, file, requestedPath || cleanFilename(file.filename), auth.actorUserId, addToTab)
      if (addToTab) { await tabConfigService.addFile(roomId, 'files', record.relativePath); await tabFilesMapService.writeRoomMap(roomId) }
      broadcast(roomId, 'files.updated', { path: record.relativePath, file: record })
      return { success: true, data: { file: record, addToTab } }
    } catch (err: any) {
      return reply.code(err.status || (err.code === 'INVALID_PATH' ? 400 : 500)).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })

  app.post('/api/agent-files/:roomId/promote', async (request, reply) => {
    const { roomId } = request.params as any
    try {
      const auth = await authenticateAgentFileRequest(roomId, request.headers.authorization)
      const body = request.body as any
      const record = await roomFileService.promote(roomId, body.ref || body.path, body.targetPath || body.target, auth.actorUserId)
      if (body.addToTab === true || body.show === true) { await tabConfigService.addFile(roomId, 'files', record.relativePath); await tabFilesMapService.writeRoomMap(roomId) }
      broadcast(roomId, 'files.updated', { path: record.relativePath, file: record })
      return { success: true, data: { file: record } }
    } catch (err: any) {
      return reply.code(err.status || (err.code === 'INVALID_PATH' ? 400 : 500)).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })
}
