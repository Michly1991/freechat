import db from '../storage/db.js'

export function requireAdmin(user: any) {
  if (user?.role !== 'admin') throw { code: 'FORBIDDEN', message: 'Admin only' }
}

export function getRoomMemberRole(roomId: string, userId: string): string | null {
  const row = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId) as any
  return row?.role || null
}

export function assertRoomMember(roomId: string, userId: string) {
  const role = getRoomMemberRole(roomId, userId)
  if (!role) throw { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' }
  return role
}

export function assertRoomEditor(roomId: string, userId: string) {
  const role = assertRoomMember(roomId, userId)
  if (!['owner', 'editor'].includes(role)) throw { code: 'FORBIDDEN', message: 'Only room owner/editor can perform this operation' }
  return role
}

export function routeAuthError(reply: any, err: any) {
  const status = err?.code === 'NOT_ROOM_MEMBER' || err?.code === 'FORBIDDEN' ? 403 : err?.code === 'ROOM_NOT_FOUND' ? 404 : 500
  return reply.code(status).send({ success: false, error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || String(err) } })
}
