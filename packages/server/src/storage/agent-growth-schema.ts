import type Database from 'better-sqlite3'

export function ensureAgentGrowthSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_growth_reviews (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      review_date TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(room_id, review_date),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_memory_proposals (
      id TEXT PRIMARY KEY,
      review_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      agent_id TEXT,
      scope TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      confidence REAL DEFAULT 0,
      evidence_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      decided_at INTEGER,
      FOREIGN KEY (review_id) REFERENCES agent_growth_reviews(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      agent_id TEXT,
      scope TEXT NOT NULL,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      source_proposal_id TEXT,
      confidence REAL DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (source_proposal_id) REFERENCES agent_memory_proposals(id) ON DELETE SET NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_growth_reviews_room_date ON agent_growth_reviews(room_id, review_date)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_memory_proposals_room_status ON agent_memory_proposals(room_id, status, created_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_memories_room_enabled ON agent_memories(room_id, enabled, updated_at)`)
}
