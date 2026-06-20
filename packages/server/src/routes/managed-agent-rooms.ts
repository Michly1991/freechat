import { FastifyInstance } from 'fastify'
import db from '../storage/db.js'

function parseJson(value?: string | null) {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

export async function registerManagedAgentRoomRoutes(app: FastifyInstance) {
  app.get('/api/managed-agent-rooms', async (request, reply) => {
    const user = (request as any).user
    const { limit = '50' } = request.query as any
    const messageLimit = Math.max(1, Math.min(Number(limit) || 50, 100))

    const rows = db.prepare(`
      SELECT DISTINCT r.id, r.name, r.description, r.last_active_at lastActiveAt, r.updated_at updatedAt
      FROM rooms r
      INNER JOIN room_agents ra ON ra.room_id = r.id
      INNER JOIN agents a ON a.id = ra.agent_id
      INNER JOIN agent_connectors c ON c.agent_id = a.id AND c.status != 'revoked'
      WHERE a.owner_id = ? AND r.deleted_at IS NULL
      ORDER BY r.last_active_at DESC
    `).all(user.id) as any[]

    const rooms = rows.map((room) => {
      const agents = db.prepare(`
        SELECT a.id, a.name, a.role_type roleType, a.deployment, ra.room_role roomRole, ra.auto_enabled autoEnabled,
          c.id connectorId, c.name connectorName, c.status connectorStatus, c.last_seen_at clientLastSeenAt
        FROM room_agents ra
        INNER JOIN agents a ON a.id = ra.agent_id
        INNER JOIN agent_connectors c ON c.agent_id = a.id AND c.status != 'revoked'
        WHERE ra.room_id = ? AND a.owner_id = ?
        ORDER BY ra.auto_enabled DESC, ra.priority ASC, a.name ASC
      `).all(room.id, user.id) as any[]
      const messages = (db.prepare(`
        SELECT id, actor_id actorId, actor_name actorName, actor_role actorRole, content, kind, payload, created_at createdAt
        FROM messages
        WHERE room_id = ?
          AND deleted = 0
          AND NOT (trim(content) LIKE '{"type":"system","subtype":"init"%')
        ORDER BY created_at DESC
        LIMIT ?
      `).all(room.id, messageLimit) as any[]).reverse().map((message) => ({ ...message, payload: parseJson(message.payload) }))
      return { ...room, agents, messages }
    })

    return reply.send({ success: true, data: { rooms } })
  })
}
