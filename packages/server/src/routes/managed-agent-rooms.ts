import { FastifyInstance } from 'fastify'
import db from '../storage/db.js'
import { getRoomMemberRole } from './route-auth.js'

export async function registerManagedAgentRoomRoutes(app: FastifyInstance) {
  app.get('/api/managed-agent-rooms', async (request, reply) => {
    const user = (request as any).user

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
      const memberRole = getRoomMemberRole(room.id, user.id)
      const agents = db.prepare(`
        SELECT a.id, a.name, a.role_type roleType, a.deployment, ra.room_role roomRole, ra.auto_enabled autoEnabled,
          c.id connectorId, c.name connectorName, c.status connectorStatus, c.last_seen_at clientLastSeenAt
        FROM room_agents ra
        INNER JOIN agents a ON a.id = ra.agent_id
        INNER JOIN agent_connectors c ON c.agent_id = a.id AND c.status != 'revoked'
        WHERE ra.room_id = ? AND a.owner_id = ?
        ORDER BY ra.auto_enabled DESC, ra.priority ASC, a.name ASC
      `).all(room.id, user.id) as any[]
      return { ...room, agents, messages: [], canReadMessages: !!memberRole, memberRole }
    })

    return reply.send({ success: true, data: { rooms } })
  })
}
