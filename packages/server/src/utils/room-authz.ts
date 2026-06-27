import db from '../storage/db.js'

export type RoomMemberRole = 'owner' | 'editor' | 'viewer'

export function getRoomMemberRole(roomId: string, userId: string): RoomMemberRole | null {
  const row = db.prepare(`
    SELECT rm.role FROM room_members rm
    INNER JOIN rooms r ON r.id = rm.room_id
    WHERE rm.room_id = ? AND rm.user_id = ? AND r.deleted_at IS NULL
  `).get(roomId, userId) as any
  return row?.role || null
}

export function assertRoomMember(roomId: string, userId: string): RoomMemberRole {
  const role = getRoomMemberRole(roomId, userId)
  if (!role) throw { code: 'NOT_ROOM_MEMBER', message: 'You are not a member of this room' }
  return role
}

export function assertRoomEditor(roomId: string, userId: string): RoomMemberRole {
  const role = assertRoomMember(roomId, userId)
  if (!['owner', 'editor'].includes(role)) throw { code: 'FORBIDDEN', message: 'Only room owner/editor can perform this operation' }
  return role
}

export function assertRoomOwner(roomId: string, userId: string): RoomMemberRole {
  const role = assertRoomMember(roomId, userId)
  if (role !== 'owner') throw { code: 'FORBIDDEN', message: 'Only room owner can perform this operation' }
  return role
}

export function countRoomOwners(roomId: string, exceptUserId?: string): number {
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM room_members rm
    INNER JOIN rooms r ON r.id = rm.room_id
    WHERE rm.room_id = ? AND rm.role = 'owner' AND r.deleted_at IS NULL
      AND (? IS NULL OR rm.user_id != ?)
  `).get(roomId, exceptUserId || null, exceptUserId || null) as any
  return Number(row?.count || 0)
}

export function assertCanChangeRoomMemberRole(roomId: string, actorUserId: string, targetUserId: string, nextRole: RoomMemberRole) {
  const actorRole = assertRoomMember(roomId, actorUserId)
  const targetRole = assertRoomMember(roomId, targetUserId)
  if (actorRole !== 'owner') {
    throw { code: 'FORBIDDEN', message: 'Only room owner can change member roles' }
  }
  if (targetRole === 'owner' && nextRole !== 'owner' && countRoomOwners(roomId, targetUserId) === 0) {
    throw { code: 'LAST_OWNER_REQUIRED', message: '房间必须至少保留一名 owner' }
  }
}

export function assertCanRemoveRoomMember(roomId: string, actorUserId: string, targetUserId: string) {
  const actorRole = assertRoomMember(roomId, actorUserId)
  const targetRole = assertRoomMember(roomId, targetUserId)
  const selfRemove = actorUserId === targetUserId
  if (!selfRemove && actorRole !== 'owner') {
    throw { code: 'FORBIDDEN', message: 'Only room owner can remove members' }
  }
  if (targetRole === 'owner' && countRoomOwners(roomId, targetUserId) === 0) {
    throw { code: 'LAST_OWNER_REQUIRED', message: '房间必须至少保留一名 owner' }
  }
}

export function assertCanAddRoomMember(roomId: string, actorUserId: string, role: RoomMemberRole) {
  const actorRole = assertRoomMember(roomId, actorUserId)
  if (role === 'owner' && actorRole !== 'owner') {
    throw { code: 'FORBIDDEN', message: 'Only room owner can add another owner' }
  }
  if (!['owner', 'editor'].includes(actorRole)) {
    throw { code: 'FORBIDDEN', message: 'Only project owner/editor can add collaborators' }
  }
}

export function routeAuthError(reply: any, err: any) {
  const status = err?.code === 'NOT_ROOM_MEMBER' || err?.code === 'FORBIDDEN' || err?.code === 'LAST_OWNER_REQUIRED' ? 403 : err?.code === 'ROOM_NOT_FOUND' ? 404 : 500
  return reply.code(status).send({ success: false, error: { code: err?.code || 'INTERNAL_ERROR', message: err?.message || String(err) } })
}
