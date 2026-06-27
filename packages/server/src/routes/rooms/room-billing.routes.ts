import { FastifyInstance } from 'fastify'
import { billingQueryRepository } from '../../domains/billing/billing-query.repository.js'
import { canViewRoomBilling, routeToInt } from './room-route-helpers.js'

export async function registerRoomBillingRoutes(app: FastifyInstance) {
app.get('/api/rooms/:id/billing/summary', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  const { allowed, fullAccess } = await canViewRoomBilling(id, user.id)
  if (!allowed) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
  const query = request.query as any
  const range = { from: query?.from ? Number(query.from) : undefined, to: query?.to ? Number(query.to) : undefined }
  const result = billingQueryRepository.roomSummary(id, user.id, fullAccess, range)
  return reply.send({ success: true, data: { ...result, scope: fullAccess ? 'room' : 'self', canViewFullRoomBilling: fullAccess } })
})

app.get('/api/rooms/:id/billing/ledger', async (request, reply) => {
  const user = (request as any).user
  const { id } = request.params as any
  const { allowed, fullAccess } = await canViewRoomBilling(id, user.id)
  if (!allowed) return reply.code(403).send({ success: false, error: { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' } })
  const query = request.query as any
  const range = { from: query?.from ? Number(query.from) : undefined, to: query?.to ? Number(query.to) : undefined }
  const limit = Math.min(100, Math.max(1, routeToInt(query?.limit || 50)))
  const items = billingQueryRepository.roomLedger(id, user.id, fullAccess, range, limit)
  return reply.send({ success: true, data: { items, scope: fullAccess ? 'room' : 'self', canViewFullRoomBilling: fullAccess } })
})

}
