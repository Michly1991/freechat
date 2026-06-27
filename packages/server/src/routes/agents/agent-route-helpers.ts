import db from '../../storage/db.js'

export function isRoomCreator(roomId: string, userId: string) {
  const row = db.prepare('SELECT created_by FROM rooms WHERE id = ?').get(roomId) as any
  return !!row?.created_by && row.created_by === userId
}

export function canCommandRoomAgent(roomId: string, userId: string) {
  const row = db.prepare('SELECT created_by, workgroup_id FROM rooms WHERE id = ?').get(roomId) as any
  if (!row) return false
  if (row.created_by === userId) return true
  const member = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId) as any
  if (member && ['owner', 'editor'].includes(member.role)) return true
  if (row.workgroup_id) {
    const wgMember = db.prepare('SELECT role FROM workgroup_members WHERE workgroup_id = ? AND user_id = ?').get(row.workgroup_id, userId) as any
    if (wgMember && ['owner', 'admin'].includes(wgMember.role)) return true
  }
  return false
}
