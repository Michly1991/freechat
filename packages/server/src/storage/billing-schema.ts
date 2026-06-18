import type Database from 'better-sqlite3'

export function ensureBillingSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_profiles (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL DEFAULT 'anthropic-compatible',
      base_url TEXT,
      api_key_cipher TEXT,
      api_key_last4 TEXT,
      default_model TEXT,
      models TEXT,
      visibility TEXT NOT NULL DEFAULT 'private',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_model_profiles_owner ON model_profiles(owner_id, enabled)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS room_agent_model_bindings (
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      model_profile_id TEXT,
      model TEXT,
      runtime TEXT,
      max_tokens INTEGER,
      temperature REAL,
      configured_by TEXT,
      extra_config TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (room_id, agent_id),
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (model_profile_id) REFERENCES model_profiles(id) ON DELETE SET NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_room_agent_model_bindings_profile ON room_agent_model_bindings(model_profile_id)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_billing_rules (
      id TEXT PRIMARY KEY,
      model_profile_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_credit_per_million INTEGER DEFAULT 0,
      output_credit_per_million INTEGER DEFAULT 0,
      cache_write_credit_per_million INTEGER DEFAULT 0,
      cache_read_credit_per_million INTEGER DEFAULT 0,
      min_credits_per_run INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (model_profile_id) REFERENCES model_profiles(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_model_billing_rules_profile_model ON model_billing_rules(model_profile_id, model)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_billing_rules (
      id TEXT PRIMARY KEY,
      agent_template_id TEXT NOT NULL,
      billing_mode TEXT NOT NULL DEFAULT 'token_multiplier',
      token_multiplier REAL DEFAULT 0,
      fixed_credits_per_run INTEGER DEFAULT 0,
      input_credit_per_million INTEGER DEFAULT 0,
      output_credit_per_million INTEGER DEFAULT 0,
      cache_write_credit_per_million INTEGER DEFAULT 0,
      cache_read_credit_per_million INTEGER DEFAULT 0,
      revenue_share_rate REAL DEFAULT 1,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (agent_template_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_billing_rules_template ON agent_billing_rules(agent_template_id)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS scene_billing_rules (
      id TEXT PRIMARY KEY,
      scene_template_id TEXT NOT NULL UNIQUE,
      billing_mode TEXT NOT NULL DEFAULT 'free',
      fixed_credits_per_use INTEGER DEFAULT 0,
      revenue_share_rate REAL DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (scene_template_id) REFERENCES scene_templates(id) ON DELETE CASCADE
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS metered_usage_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL UNIQUE,
      room_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_template_id TEXT,
      payer_user_id TEXT NOT NULL,
      agent_provider_user_id TEXT,
      model_provider_user_id TEXT,
      model_profile_id TEXT,
      runtime TEXT,
      model TEXT,
      model_source TEXT,
      base_url_host TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      snapshot_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_metered_usage_events_status_created ON metered_usage_events(status, created_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_metered_usage_events_payer ON metered_usage_events(payer_user_id, created_at)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_ledger_entries (
      id TEXT PRIMARY KEY,
      usage_event_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      account_user_id TEXT NOT NULL,
      account_role TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'CREDIT',
      room_id TEXT,
      agent_id TEXT,
      agent_template_id TEXT,
      model_profile_id TEXT,
      model TEXT,
      token_snapshot_json TEXT,
      rule_snapshot_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (usage_event_id) REFERENCES metered_usage_events(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_ledger_entries_event_type_role ON billing_ledger_entries(usage_event_id, entry_type, account_role)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_billing_ledger_entries_account ON billing_ledger_entries(account_user_id, account_role, created_at)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_accounts (
      user_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      income_balance INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `)
  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      run_id TEXT,
      ledger_id TEXT,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance_after INTEGER,
      note TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL,
      FOREIGN KEY (ledger_id) REFERENCES billing_ledger_entries(id) ON DELETE SET NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created ON credit_transactions(user_id, created_at)`)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_ledger_type ON credit_transactions(ledger_id, type)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_daily_stats (
      stat_date TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      room_id TEXT NOT NULL DEFAULT '',
      agent_template_id TEXT NOT NULL DEFAULT '',
      model_profile_id TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      credits INTEGER DEFAULT 0,
      entry_count INTEGER DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (stat_date, user_id, role, room_id, agent_template_id, model_profile_id, model)
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_billing_daily_stats_user_role_date ON billing_daily_stats(user_id, role, stat_date)`)
}
