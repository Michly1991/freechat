import db from './db.js'

export function ensureKnowledgeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      owner_user_id TEXT,
      agent_id TEXT,
      room_id TEXT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      source_type TEXT DEFAULT 'manual',
      source_file_id TEXT,
      status TEXT DEFAULT 'active',
      visibility TEXT DEFAULT 'private',
      created_by TEXT NOT NULL,
      updated_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_scope ON knowledge_entries(scope, status);
    CREATE INDEX IF NOT EXISTS idx_knowledge_agent ON knowledge_entries(agent_id, status);
    CREATE INDEX IF NOT EXISTS idx_knowledge_room ON knowledge_entries(room_id, status);
    CREATE INDEX IF NOT EXISTS idx_knowledge_owner ON knowledge_entries(owner_user_id, status);
  `)
}
