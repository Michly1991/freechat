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

    CREATE TABLE IF NOT EXISTS agent_knowledge_files (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      mime_type TEXT DEFAULT 'text/plain',
      content TEXT NOT NULL DEFAULT '',
      size INTEGER DEFAULT 0,
      checksum TEXT,
      created_by TEXT NOT NULL,
      updated_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_knowledge_files_agent ON agent_knowledge_files(agent_id, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_agent_knowledge_files_owner ON agent_knowledge_files(owner_user_id, deleted_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_knowledge_files_active_path ON agent_knowledge_files(agent_id, path) WHERE deleted_at IS NULL;

    CREATE TABLE IF NOT EXISTS agent_knowledge_indexes (
      agent_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'empty',
      file_count INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0,
      last_indexed_at INTEGER,
      error_message TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    );
  `)
}
