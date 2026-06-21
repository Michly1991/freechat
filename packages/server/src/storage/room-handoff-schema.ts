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
}
