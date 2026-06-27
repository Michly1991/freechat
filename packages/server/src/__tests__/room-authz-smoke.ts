import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const temp = mkdtempSync(join(tmpdir(), 'freechat-authz-'))
process.env.DATABASE_PATH = join(temp, 'freechat.db')
process.env.WORKSPACE_ROOT = join(temp, 'workspace')
process.env.UPLOAD_DIR = join(temp, 'uploads')

const { default: db, initDatabase } = await import('../storage/db.js')
const { assertCanAddRoomMember, assertCanChangeRoomMemberRole, assertCanRemoveRoomMember } = await import('../utils/room-authz.js')

function user(id: string) {
  db.prepare('INSERT INTO users (id, username, password_hash, nickname, role, identity_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, id, 'x', id, 'user', 'human', Date.now(), Date.now())
}

function expectThrows(code: string, fn: () => void) {
  try {
    fn()
  } catch (err: any) {
    if (err.code !== code) throw new Error(`Expected ${code}, got ${err.code}`)
    return
  }
  throw new Error(`Expected ${code} to be thrown`)
}

try {
  initDatabase()
  user('owner')
  user('editor')
  user('viewer')
  user('target')
  db.prepare('INSERT INTO rooms (id, name, created_by, created_at, updated_at, last_active_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('room', 'Room', 'owner', Date.now(), Date.now(), Date.now())
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)').run('room', 'owner', 'owner', 'human', Date.now())
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)').run('room', 'editor', 'editor', 'human', Date.now())
  db.prepare('INSERT INTO room_members (room_id, user_id, role, type, joined_at) VALUES (?, ?, ?, ?, ?)').run('room', 'viewer', 'viewer', 'human', Date.now())

  assertCanAddRoomMember('room', 'editor', 'viewer')
  expectThrows('FORBIDDEN', () => assertCanAddRoomMember('room', 'editor', 'owner'))
  expectThrows('FORBIDDEN', () => assertCanAddRoomMember('room', 'viewer', 'viewer'))

  assertCanChangeRoomMemberRole('room', 'owner', 'editor', 'viewer')
  expectThrows('FORBIDDEN', () => assertCanChangeRoomMemberRole('room', 'editor', 'viewer', 'editor'))
  expectThrows('LAST_OWNER_REQUIRED', () => assertCanChangeRoomMemberRole('room', 'owner', 'owner', 'editor'))

  assertCanRemoveRoomMember('room', 'owner', 'viewer')
  expectThrows('FORBIDDEN', () => assertCanRemoveRoomMember('room', 'editor', 'viewer'))
  expectThrows('LAST_OWNER_REQUIRED', () => assertCanRemoveRoomMember('room', 'owner', 'owner'))

  console.log('room authz smoke passed')
} finally {
  db.close()
  rmSync(temp, { recursive: true, force: true })
}
