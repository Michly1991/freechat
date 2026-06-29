import { FastifyInstance } from 'fastify'
import { mindmapArtifactService } from '../services/mindmap-artifact.service.js'
import { assertRoomMember, routeAuthError } from './route-auth.js'
import { getGateway } from '../ws/gateway.js'

export async function registerMindmapArtifactRoutes(app: FastifyInstance) {
  app.post('/api/rooms/:roomId/mindmaps/save', async (request, reply) => {
    const { roomId } = request.params as any
    const user = (request as any).user
    try { assertRoomMember(roomId, user.id) } catch (err: any) { return routeAuthError(reply, err) }
    try {
      const saved = await mindmapArtifactService.save(roomId, user.id, request.body || {})
      getGateway()?.broadcast(roomId, { msgId: `files_${Date.now()}`, roomId, type: 'broadcast', action: 'files.updated', payload: { path: saved.directory, file: saved.entryFile }, timestamp: Date.now() })
      return { success: true, data: { saved } }
    } catch (err: any) {
      return reply.code(err?.code === 'VALIDATION_ERROR' ? 400 : 500).send({ success: false, error: { message: err.message || String(err) } })
    }
  })

  app.get('/api/rooms/:roomId/mindmap-previews/:previewId/:file?', async (request, reply) => {
    const { roomId, previewId, file } = request.params as any
    const user = (request as any).user
    try { assertRoomMember(roomId, user.id) } catch (err: any) { return routeAuthError(reply, err) }
    try {
      const name = String(file || 'index.html')
      const body = await mindmapArtifactService.renderTmp(roomId, previewId, name)
      const contentType = name.endsWith('.svg') ? 'image/svg+xml; charset=utf-8' : name.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8'
      if (contentType.startsWith('text/html') || contentType.startsWith('image/svg+xml')) return reply.type(contentType).send(body)
      return { success: true, data: JSON.parse(body) }
    } catch (err: any) {
      return reply.code(err?.code === 'VALIDATION_ERROR' ? 400 : 404).send({ success: false, error: { message: err.message || 'Preview not found' } })
    }
  })
}
