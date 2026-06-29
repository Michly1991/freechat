import { FastifyInstance } from 'fastify'
import { verifyAgentToolToken } from '../agent-tool-token.js'
import { agentService } from '../services/agent.service.js'
import { remoteAgentConnectorService } from '../services/remote-agent-connector.service.js'
import { isPersonalTool } from './agent-tools-auth.js'
import { actorForRemote, executeAgentTool, remoteToolErrorStatus } from './remote-agent-app-call.js'
import { canonicalizeToolAction } from '../app-actions/risk-policy.js'
import db from '../storage/db.js'

export async function registerAgentToolRoutes(app: FastifyInstance) {
  app.post('/api/agent-tools/:roomId', async (request, reply) => {
    const { roomId } = request.params as any
    const body = request.body as any
    const action = canonicalizeToolAction(String(body.action || body.tool || ''))
    const auth = request.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    let verified = verifyAgentToolToken(roomId, token)
    let remoteAuth: any = null
    if (!verified.ok || !verified.agentId) {
      remoteAuth = await remoteAgentConnectorService.authenticateBearer(request.headers.authorization)
      if (remoteAuth) verified = { ok: true, agentId: remoteAuth.agentId, actorUserId: actorForRemote(remoteAuth, roomId, action, body?.actorUserId || body?.args?.actorUserId, body?.runId || body?.args?.runId) }
    }
    if (!verified.ok || !verified.agentId) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid agent tool token' } })
    }
    const agent = await agentService.getAgent(verified.agentId)
    const actorUserId = verified.actorUserId || (!isPersonalTool(action) ? ((db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(roomId) as any)?.created_by || agent.ownerId || agent.id) : undefined)
    if (isPersonalTool(action) && !actorUserId) {
      return reply.code(403).send({ success: false, error: { code: 'ACTOR_REQUIRED', message: 'This tool requires a user-scoped actorUserId token' } })
    }
    try {
      const actor = actorUserId ? db.prepare('SELECT role FROM users WHERE id = ?').get(actorUserId) as any : null
      return await executeAgentTool({ roomId, action, args: body.args || {}, agentId: agent.id, actorUserId, actorRole: actor?.role, remoteAuth })
    } catch (err: any) {
      return reply.code(remoteToolErrorStatus(err)).send({ success: false, error: { code: err.code || 'INTERNAL_ERROR', message: err.message || String(err) } })
    }
  })
}
