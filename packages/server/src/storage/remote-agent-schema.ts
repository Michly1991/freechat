import type Database from 'better-sqlite3'

export function ensureRemoteAgentSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_connector_pairing_codes (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_connector_pairing_agent ON agent_connector_pairing_codes(agent_id, status, expires_at)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_connectors (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      instance_id TEXT,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      client_version TEXT,
      capabilities_json TEXT,
      last_seen_at INTEGER,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_connectors_agent_status ON agent_connectors(agent_id, status, last_seen_at)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_connector_tokens (
      id TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      token_prefix TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at INTEGER,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (connector_id) REFERENCES agent_connectors(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_connector_tokens_prefix ON agent_connector_tokens(token_prefix, status)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS remote_agent_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      delivered_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_remote_agent_events_agent_status_created ON remote_agent_events(agent_id, status, created_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_remote_agent_events_run ON remote_agent_events(run_id)`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_client_bind_requests (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      preferred_instance_id TEXT,
      claimed_connector_id TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      claimed_at INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (claimed_connector_id) REFERENCES agent_connectors(id) ON DELETE SET NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_client_bind_requests_owner_status ON agent_client_bind_requests(owner_id, status, created_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_client_bind_requests_agent_status ON agent_client_bind_requests(agent_id, status, created_at)`)
}
