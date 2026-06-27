import type Database from 'better-sqlite3'

export function ensureInviteSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_invites (
      code TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      max_uses INTEGER,
      used_count INTEGER DEFAULT 0,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `)
  for (const [name, ddl] of [
    ['role', "ALTER TABLE room_invites ADD COLUMN role TEXT DEFAULT 'viewer'"],
    ['revoked_at', 'ALTER TABLE room_invites ADD COLUMN revoked_at INTEGER'],
    ['revoked_by', 'ALTER TABLE room_invites ADD COLUMN revoked_by TEXT'],
  ] as const) {
    if (!(db.prepare('PRAGMA table_info(room_invites)').all() as any[]).some((col) => col.name === name)) db.exec(ddl)
  }
}
