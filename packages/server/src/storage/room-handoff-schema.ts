import type Database from 'better-sqlite3'

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).some((col) => col.name === column)
}

export function ensureRoomHandoffSchema(db: Database.Database) {
  const add = (name: string, ddl: string) => { if (!hasColumn(db, 'rooms', name)) db.exec(`ALTER TABLE rooms ADD COLUMN ${ddl}`) }
  add('assistant_mode', "assistant_mode TEXT DEFAULT 'fixed'")
  add('current_assistant_agent_id', 'current_assistant_agent_id TEXT')
  add('assistant_handoff_at', 'assistant_handoff_at INTEGER')
  add('assistant_handoff_by', 'assistant_handoff_by TEXT')
  add('assistant_handoff_reason', 'assistant_handoff_reason TEXT')
  db.exec(`CREATE TABLE IF NOT EXISTS room_assistant_handoffs (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, from_agent_id TEXT, to_agent_id TEXT NOT NULL,
    requested_by TEXT NOT NULL, requested_by_type TEXT NOT NULL, source TEXT NOT NULL,
    reason TEXT, created_at INTEGER NOT NULL
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_room_assistant_handoffs_room ON room_assistant_handoffs(room_id, created_at DESC)')
  db.exec(`CREATE TABLE IF NOT EXISTS room_assistant_handoff_requests (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, from_agent_id TEXT, to_agent_id TEXT NOT NULL,
    requested_by TEXT NOT NULL, requested_by_type TEXT NOT NULL, source TEXT NOT NULL,
    reason TEXT, status TEXT NOT NULL DEFAULT 'pending', policy TEXT DEFAULT 'auto',
    decision_reason TEXT, created_at INTEGER NOT NULL, decided_at INTEGER
  )`)
  db.exec('CREATE INDEX IF NOT EXISTS idx_room_assistant_handoff_requests_room ON room_assistant_handoff_requests(room_id, created_at DESC)')
}
