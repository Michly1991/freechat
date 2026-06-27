import { assertRoomEditor, assertRoomMember, assertRoomOwner, getRoomMemberRole, routeAuthError } from '../utils/room-authz.js'

export function requireAdmin(user: any) {
  if (user?.role !== 'admin') throw { code: 'FORBIDDEN', message: 'Admin only' }
}

export { assertRoomEditor, assertRoomMember, assertRoomOwner, getRoomMemberRole, routeAuthError }
