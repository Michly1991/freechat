import type Database from 'better-sqlite3'

export function ensureRoomSchema(db: Database.Database) {
  // Rooms table
  db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL, room_kind TEXT DEFAULT 'project', direct_key TEXT, direct_target_type TEXT, direct_target_id TEXT,
      scene_template_id TEXT,
      scene_template_version INTEGER,
      deleted_at INTEGER,
      deleted_by TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `)

  const roomCols = db.prepare('PRAGMA table_info(rooms)').all() as any[]
  if (!roomCols.some((col) => col.name === 'room_kind')) db.exec("ALTER TABLE rooms ADD COLUMN room_kind TEXT DEFAULT 'project'"); if (!roomCols.some((col) => col.name === 'direct_key')) db.exec('ALTER TABLE rooms ADD COLUMN direct_key TEXT')
  if (!roomCols.some((col) => col.name === 'direct_target_type')) db.exec('ALTER TABLE rooms ADD COLUMN direct_target_type TEXT'); if (!roomCols.some((col) => col.name === 'direct_target_id')) db.exec('ALTER TABLE rooms ADD COLUMN direct_target_id TEXT')
  if (!roomCols.some((col) => col.name === 'scene_template_id')) db.exec('ALTER TABLE rooms ADD COLUMN scene_template_id TEXT')
  if (!roomCols.some((col) => col.name === 'scene_template_version')) db.exec('ALTER TABLE rooms ADD COLUMN scene_template_version INTEGER')
  if (!roomCols.some((col) => col.name === 'deleted_at')) db.exec('ALTER TABLE rooms ADD COLUMN deleted_at INTEGER')
  if (!roomCols.some((col) => col.name === 'deleted_by')) db.exec('ALTER TABLE rooms ADD COLUMN deleted_by TEXT')
  db.exec('CREATE INDEX IF NOT EXISTS idx_rooms_direct_key ON rooms(direct_key)')

  // Room members table
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_members (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      type TEXT DEFAULT 'human',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (room_id, user_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    )
  `)
}
