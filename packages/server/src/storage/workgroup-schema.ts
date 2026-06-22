import type Database from 'better-sqlite3'

export function ensureWorkgroupSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workgroups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      owner_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workgroup_members (
      workgroup_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (workgroup_id, user_id),
      FOREIGN KEY (workgroup_id) REFERENCES workgroups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workgroup_agents (
      workgroup_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      enabled INTEGER NOT NULL DEFAULT 1,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (workgroup_id, agent_id),
      FOREIGN KEY (workgroup_id) REFERENCES workgroups(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workgroup_entries (
      id TEXT PRIMARY KEY,
      workgroup_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      access_mode TEXT NOT NULL DEFAULT 'private_link',
      token_hash TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (workgroup_id) REFERENCES workgroups(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)
  const roomCols = db.prepare('PRAGMA table_info(rooms)').all() as any[]
  if (!roomCols.some((col) => col.name === 'workgroup_id')) db.exec('ALTER TABLE rooms ADD COLUMN workgroup_id TEXT')
  if (!roomCols.some((col) => col.name === 'workgroup_entry_id')) db.exec('ALTER TABLE rooms ADD COLUMN workgroup_entry_id TEXT')
  if (!roomCols.some((col) => col.name === 'source_room_id')) db.exec('ALTER TABLE rooms ADD COLUMN source_room_id TEXT')
  db.exec('CREATE INDEX IF NOT EXISTS idx_rooms_workgroup ON rooms(workgroup_id, last_active_at)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_workgroup_members_user ON workgroup_members(user_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_workgroup_agents_agent ON workgroup_agents(agent_id)')
}
