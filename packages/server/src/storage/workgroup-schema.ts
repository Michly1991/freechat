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
      token TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      welcome_message TEXT,
      max_uses INTEGER,
      used_count INTEGER DEFAULT 0,
      expires_at INTEGER,
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
  if (!roomCols.some((col) => col.name === 'workgroup_entry_share_link_id')) db.exec('ALTER TABLE rooms ADD COLUMN workgroup_entry_share_link_id TEXT')
  if (!roomCols.some((col) => col.name === 'workgroup_entry_sharer_user_id')) db.exec('ALTER TABLE rooms ADD COLUMN workgroup_entry_sharer_user_id TEXT')
  db.exec('CREATE INDEX IF NOT EXISTS idx_rooms_workgroup ON rooms(workgroup_id, last_active_at)')
  const entryCols = db.prepare('PRAGMA table_info(workgroup_entries)').all() as any[]
  if (!entryCols.some((col) => col.name === 'token')) db.exec('ALTER TABLE workgroup_entries ADD COLUMN token TEXT')
  if (!entryCols.some((col) => col.name === 'welcome_message')) db.exec('ALTER TABLE workgroup_entries ADD COLUMN welcome_message TEXT')
  if (!entryCols.some((col) => col.name === 'max_uses')) db.exec('ALTER TABLE workgroup_entries ADD COLUMN max_uses INTEGER')
  if (!entryCols.some((col) => col.name === 'used_count')) db.exec('ALTER TABLE workgroup_entries ADD COLUMN used_count INTEGER DEFAULT 0')
  if (!entryCols.some((col) => col.name === 'expires_at')) db.exec('ALTER TABLE workgroup_entries ADD COLUMN expires_at INTEGER')
  db.exec('CREATE INDEX IF NOT EXISTS idx_workgroup_members_user ON workgroup_members(user_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_workgroup_agents_agent ON workgroup_agents(agent_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_workgroup_entries_workgroup ON workgroup_entries(workgroup_id, enabled)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_workgroup_entries_token ON workgroup_entries(token_hash)')
  db.exec(`
    CREATE TABLE IF NOT EXISTS workgroup_entry_share_links (
      id TEXT PRIMARY KEY,
      workgroup_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      sharer_user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      visit_count INTEGER NOT NULL DEFAULT 0,
      join_count INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(entry_id, sharer_user_id),
      FOREIGN KEY (workgroup_id) REFERENCES workgroups(id) ON DELETE CASCADE,
      FOREIGN KEY (entry_id) REFERENCES workgroup_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (sharer_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS workgroup_entry_share_events (
      id TEXT PRIMARY KEY,
      workgroup_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      share_link_id TEXT,
      sharer_user_id TEXT,
      visitor_user_id TEXT,
      event_type TEXT NOT NULL,
      room_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (workgroup_id) REFERENCES workgroups(id) ON DELETE CASCADE,
      FOREIGN KEY (entry_id) REFERENCES workgroup_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (share_link_id) REFERENCES workgroup_entry_share_links(id) ON DELETE SET NULL
    )
  `)
  db.exec('CREATE INDEX IF NOT EXISTS idx_workgroup_entry_share_links_entry ON workgroup_entry_share_links(entry_id, sharer_user_id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_workgroup_entry_share_links_token ON workgroup_entry_share_links(token_hash)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_workgroup_entry_share_events_entry ON workgroup_entry_share_events(entry_id, created_at)')
}
