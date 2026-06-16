import type Database from 'better-sqlite3'

export function ensureAgentDreamSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_dreams (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      dream_date TEXT NOT NULL,
      status TEXT NOT NULL,
      error_count INTEGER DEFAULT 0,
      summary TEXT,
      proposed_changes_json TEXT,
      applied_changes_json TEXT,
      created_at INTEGER NOT NULL,
      applied_at INTEGER,
      UNIQUE(room_id, agent_id, dream_date),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_dream_fixes (
      id TEXT PRIMARY KEY,
      dream_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      before_text TEXT,
      after_text TEXT,
      reason TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (dream_id) REFERENCES agent_dreams(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_dreams_date_room ON agent_dreams(dream_date, room_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_dreams_agent_date ON agent_dreams(agent_id, dream_date)`)
}
