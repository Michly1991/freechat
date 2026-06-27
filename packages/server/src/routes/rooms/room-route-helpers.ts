import db from '../../storage/db.js'
import { roomService } from '../../services/room.service.js'

export function routeToInt(value: any): number {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

export async function canViewRoomBilling(roomId: string, userId: string) {
  const room = db.prepare('SELECT id, created_by, room_kind, workgroup_entry_id FROM rooms WHERE id = ? AND deleted_at IS NULL').get(roomId) as any
  if (!room) throw { code: 'ROOM_NOT_FOUND', message: 'Room not found' }
  const isMember = await roomService.isMember(roomId, userId)
  if (!isMember) return { allowed: false, fullAccess: false, room }
  const fullAccess = room.created_by === userId
  return { allowed: true, fullAccess, room }
}
