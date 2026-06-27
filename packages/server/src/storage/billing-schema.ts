import type Database from 'better-sqlite3'

const MICROCREDITS_PER_CREDIT = 10000
const MICROCREDIT_MIGRATION_KEY = 'billing_amount_unit'
const MICROCREDIT_MIGRATION_VALUE = 'microcredit_10000'

function ensureBillingLedgerRetentionForeignKeys(db: Database.Database) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'billing_ledger_entries'").get()
  if (!table) return

  const foreignKeys = db.prepare('PRAGMA foreign_key_list(billing_ledger_entries)').all() as any[]
  const cascades = foreignKeys.some((fk) => ['usage_event_id', 'run_id'].includes(fk.from) && fk.on_delete === 'CASCADE')
  const cols = db.prepare('PRAGMA table_info(billing_ledger_entries)').all() as any[]
  const hasRequiredRuntimeRefs = cols.some((col) => col.name === 'usage_event_id' && col.notnull) || cols.some((col) => col.name === 'run_id' && col.notnull)
  if (!cascades && !hasRequiredRuntimeRefs) return

  db.pragma('foreign_keys = OFF')
  try {
    db.exec('ALTER TABLE billing_ledger_entries RENAME TO billing_ledger_entries_legacy')
    db.exec(`
      CREATE TABLE billing_ledger_entries (
        id TEXT PRIMARY KEY,
        usage_event_id TEXT,
        run_id TEXT,
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
        FOREIGN KEY (usage_event_id) REFERENCES metered_usage_events(id) ON DELETE SET NULL,
        FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
      )
    `)
    db.exec(`
      INSERT INTO billing_ledger_entries (
        id, usage_event_id, run_id, account_user_id, account_role, direction, entry_type, amount, currency,
        room_id, agent_id, agent_template_id, model_profile_id, model, token_snapshot_json, rule_snapshot_json, created_at
      )
      SELECT id, usage_event_id, run_id, account_user_id, account_role, direction, entry_type, amount, currency,
        room_id, agent_id, agent_template_id, model_profile_id, model, token_snapshot_json, rule_snapshot_json, created_at
      FROM billing_ledger_entries_legacy
    `)
    db.exec('DROP TABLE billing_ledger_entries_legacy')
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

function ensureCreditTransactionsLedgerForeignKey(db: Database.Database) {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'credit_transactions'").get()
  if (!table) return

  const foreignKeys = db.prepare('PRAGMA foreign_key_list(credit_transactions)').all() as any[]
  const ledgerForeignKey = foreignKeys.find((fk) => fk.from === 'ledger_id')
  if (ledgerForeignKey?.table === 'billing_ledger_entries') return

  db.exec('ALTER TABLE credit_transactions RENAME TO credit_transactions_legacy')
  db.exec(`
    CREATE TABLE credit_transactions (
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
  db.exec(`
    INSERT INTO credit_transactions (id, user_id, run_id, ledger_id, type, amount, balance_after, note, created_at)
    SELECT id, user_id, run_id,
      CASE WHEN ledger_id IS NOT NULL AND EXISTS (SELECT 1 FROM billing_ledger_entries ble WHERE ble.id = credit_transactions_legacy.ledger_id) THEN ledger_id ELSE NULL END,
      type, amount, balance_after, note, created_at
    FROM credit_transactions_legacy
  `)
  db.exec('DROP TABLE credit_transactions_legacy')
}

function ensureAgentPurchasesLedgerForeignKey(db: Database.Database) {
  const legacyExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_purchases_legacy'").get()
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_purchases'").get()
  if (!table && !legacyExists) return
  if (!legacyExists && table) {
    const foreignKeys = db.prepare('PRAGMA foreign_key_list(agent_purchases)').all() as any[]
    const ledgerForeignKey = foreignKeys.find((fk) => fk.from === 'ledger_id')
    if (ledgerForeignKey?.table === 'billing_ledger_entries') return
    db.exec('ALTER TABLE agent_purchases RENAME TO agent_purchases_legacy')
  } else if (legacyExists && table) {
    db.exec('DROP TABLE agent_purchases')
  }

  db.exec(`
    CREATE TABLE agent_purchases (
      id TEXT PRIMARY KEY,
      buyer_user_id TEXT NOT NULL,
      agent_template_id TEXT NOT NULL,
      room_id TEXT,
      price_microcredits INTEGER NOT NULL DEFAULT 0,
      ledger_id TEXT,
      purchased_at INTEGER NOT NULL,
      FOREIGN KEY (buyer_user_id) REFERENCES users(id),
      FOREIGN KEY (agent_template_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
      FOREIGN KEY (ledger_id) REFERENCES billing_ledger_entries(id) ON DELETE SET NULL,
      UNIQUE(buyer_user_id, agent_template_id)
    )
  `)
  const legacyCols = db.prepare('PRAGMA table_info(agent_purchases_legacy)').all() as any[]
  const priceColumn = legacyCols.some((col) => col.name === 'price_microcredits')
    ? 'price_microcredits'
    : legacyCols.some((col) => col.name === 'price_credits')
      ? 'price_credits'
      : '0'
  db.exec(`
    INSERT INTO agent_purchases (id, buyer_user_id, agent_template_id, room_id, price_microcredits, ledger_id, purchased_at)
    SELECT id, buyer_user_id, agent_template_id, room_id, COALESCE(${priceColumn}, 0),
      CASE WHEN ledger_id IS NOT NULL AND EXISTS (SELECT 1 FROM billing_ledger_entries ble WHERE ble.id = agent_purchases_legacy.ledger_id) THEN ledger_id ELSE NULL END,
      purchased_at
    FROM agent_purchases_legacy
  `)
  db.exec('DROP TABLE agent_purchases_legacy')
}

function ensureBillingMetaTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `)
}

function multiplyColumnIfExists(db: Database.Database, table: string, column: string, factor: number) {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  if (!exists) return
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[]
  if (!cols.some((col) => col.name === column)) return
  db.prepare(`UPDATE ${table} SET ${column} = ${column} * ? WHERE ${column} IS NOT NULL`).run(factor)
}

function ensureMicrocreditMigration(db: Database.Database) {
  ensureBillingMetaTable(db)
  const row = db.prepare('SELECT value FROM app_metadata WHERE key = ?').get(MICROCREDIT_MIGRATION_KEY) as any
  if (row?.value === MICROCREDIT_MIGRATION_VALUE) return
  const previousFactor = row?.value === 'microcredit_100' ? 100 : 1
  const migrationFactor = MICROCREDITS_PER_CREDIT / previousFactor

  const tx = db.transaction(() => {
    for (const [table, column] of [
      ['model_billing_rules', 'input_credit_per_million'],
      ['model_billing_rules', 'output_credit_per_million'],
      ['model_billing_rules', 'cache_write_credit_per_million'],
      ['model_billing_rules', 'cache_read_credit_per_million'],
      ['model_billing_rules', 'min_credits_per_run'],
      ['agent_billing_rules', 'fixed_credits_per_run'],
      ['agent_billing_rules', 'fixed_credits_per_purchase'],
      ['agent_billing_rules', 'input_credit_per_million'],
      ['agent_billing_rules', 'output_credit_per_million'],
      ['agent_billing_rules', 'cache_write_credit_per_million'],
      ['agent_billing_rules', 'cache_read_credit_per_million'],
      ['agent_billing_rules', 'min_credits_per_run'],
      ['agent_purchases', 'price_microcredits'],
      ['scene_billing_rules', 'fixed_credits_per_purchase'],
      ['billing_ledger_entries', 'amount'],
      ['credit_accounts', 'balance'],
      ['credit_accounts', 'income_balance'],
      ['credit_transactions', 'amount'],
      ['credit_transactions', 'balance_after'],
      ['billing_daily_stats', 'credits'],
    ] as Array<[string, string]>) {
      multiplyColumnIfExists(db, table, column, migrationFactor)
    }
    db.prepare('INSERT OR REPLACE INTO app_metadata (key, value, updated_at) VALUES (?, ?, ?)').run(MICROCREDIT_MIGRATION_KEY, MICROCREDIT_MIGRATION_VALUE, Date.now())
  })
  tx()
}

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
    CREATE TABLE IF NOT EXISTS agent_model_defaults (
      agent_id TEXT PRIMARY KEY,
      model_profile_id TEXT,
      model TEXT,
      runtime TEXT,
      max_tokens INTEGER,
      temperature REAL,
      configured_by TEXT,
      allow_paid_shared_model INTEGER NOT NULL DEFAULT 0,
      extra_config TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (model_profile_id) REFERENCES model_profiles(id) ON DELETE SET NULL
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_model_defaults_profile ON agent_model_defaults(model_profile_id)`)
  const agentDefaultModelCols = db.prepare('PRAGMA table_info(agent_model_defaults)').all() as any[]
  if (!agentDefaultModelCols.some((col) => col.name === 'allow_paid_shared_model')) db.exec('ALTER TABLE agent_model_defaults ADD COLUMN allow_paid_shared_model INTEGER NOT NULL DEFAULT 0')
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_profile_permissions (
      id TEXT PRIMARY KEY,
      model_profile_id TEXT NOT NULL,
      user_id TEXT,
      agent_id TEXT,
      permission TEXT NOT NULL DEFAULT 'use',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (model_profile_id) REFERENCES model_profiles(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_model_profile_permissions_profile ON model_profile_permissions(model_profile_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_model_profile_permissions_user ON model_profile_permissions(user_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_model_profile_permissions_agent ON model_profile_permissions(agent_id)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_purchases (
      id TEXT PRIMARY KEY,
      buyer_user_id TEXT NOT NULL,
      model_profile_id TEXT NOT NULL,
      ledger_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (buyer_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (model_profile_id) REFERENCES model_profiles(id) ON DELETE CASCADE
    )
  `)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_model_purchases_buyer_profile ON model_purchases(buyer_user_id, model_profile_id)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_purchase_rules (
      id TEXT PRIMARY KEY,
      model_profile_id TEXT NOT NULL UNIQUE,
      purchase_mode TEXT NOT NULL DEFAULT 'free',
      fixed_credits_per_purchase INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (model_profile_id) REFERENCES model_profiles(id) ON DELETE CASCADE
    )
  `)
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
      billing_mode TEXT NOT NULL DEFAULT 'free',
      token_multiplier REAL DEFAULT 0,
      fixed_credits_per_run INTEGER DEFAULT 0,
      input_credit_per_million INTEGER DEFAULT 0,
      output_credit_per_million INTEGER DEFAULT 0,
      cache_write_credit_per_million INTEGER DEFAULT 0,
      cache_read_credit_per_million INTEGER DEFAULT 0,
      min_credits_per_run INTEGER DEFAULT 0,
      model_free_runs_per_day INTEGER DEFAULT 0,
      model_overage_policy TEXT DEFAULT 'charge',
      revenue_share_rate REAL DEFAULT 1,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (agent_template_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `)
  const agentRuleCols = db.prepare('PRAGMA table_info(agent_billing_rules)').all() as any[]
  if (!agentRuleCols.some((col) => col.name === 'billing_mode')) {
    db.exec("ALTER TABLE agent_billing_rules ADD COLUMN billing_mode TEXT NOT NULL DEFAULT 'free'")
  }
  const refreshedAgentRuleCols = db.prepare('PRAGMA table_info(agent_billing_rules)').all() as any[]
  if (!refreshedAgentRuleCols.some((col) => col.name === 'fixed_credits_per_purchase')) {
    db.exec('ALTER TABLE agent_billing_rules ADD COLUMN fixed_credits_per_purchase INTEGER DEFAULT 0')
  }
  if (!refreshedAgentRuleCols.some((col) => col.name === 'min_credits_per_run')) {
    db.exec('ALTER TABLE agent_billing_rules ADD COLUMN min_credits_per_run INTEGER DEFAULT 0')
  }
  if (!refreshedAgentRuleCols.some((col) => col.name === 'model_free_runs_per_day')) db.exec('ALTER TABLE agent_billing_rules ADD COLUMN model_free_runs_per_day INTEGER DEFAULT 0')
  if (!refreshedAgentRuleCols.some((col) => col.name === 'model_overage_policy')) db.exec("ALTER TABLE agent_billing_rules ADD COLUMN model_overage_policy TEXT DEFAULT 'charge'")
  db.exec(`
    UPDATE agent_billing_rules
    SET billing_mode = 'free',
        fixed_credits_per_run = 0,
        fixed_credits_per_purchase = 0,
        input_credit_per_million = 0,
        output_credit_per_million = 0,
        cache_write_credit_per_million = 0,
        cache_read_credit_per_million = 0,
        min_credits_per_run = 0,
        model_free_runs_per_day = 0,
        model_overage_policy = 'charge'
    WHERE enabled = 1 AND billing_mode NOT IN ('free', 'per_token')
  `)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_billing_rules_template ON agent_billing_rules(agent_template_id)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_purchases (
      id TEXT PRIMARY KEY,
      buyer_user_id TEXT NOT NULL,
      agent_template_id TEXT NOT NULL,
      room_id TEXT,
      ledger_id TEXT,
      price_microcredits INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      purchased_at INTEGER NOT NULL,
      FOREIGN KEY (buyer_user_id) REFERENCES users(id),
      FOREIGN KEY (agent_template_id) REFERENCES agents(id) ON DELETE CASCADE,
      FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE SET NULL,
      FOREIGN KEY (ledger_id) REFERENCES billing_ledger_entries(id) ON DELETE SET NULL
    )
  `)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_purchases_buyer_template ON agent_purchases(buyer_user_id, agent_template_id)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_purchases_room ON agent_purchases(room_id, purchased_at)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS market_follows (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, target_type, target_id)
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_market_follows_user_type ON market_follows(user_id, target_type, created_at)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS scene_purchases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      scene_template_id TEXT NOT NULL,
      price_microcredits INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      purchased_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (scene_template_id) REFERENCES scene_templates(id) ON DELETE CASCADE,
      UNIQUE(user_id, scene_template_id)
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_scene_purchases_user ON scene_purchases(user_id, purchased_at)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS scene_billing_rules (
      id TEXT PRIMARY KEY,
      scene_template_id TEXT NOT NULL UNIQUE,
      billing_mode TEXT NOT NULL DEFAULT 'free',
      fixed_credits_per_purchase INTEGER DEFAULT 0,
      revenue_share_rate REAL DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (scene_template_id) REFERENCES scene_templates(id) ON DELETE CASCADE
    )
  `)
  const sceneRuleCols = db.prepare('PRAGMA table_info(scene_billing_rules)').all() as any[]
  if (!sceneRuleCols.some((col) => col.name === 'fixed_credits_per_purchase')) {
    db.exec('ALTER TABLE scene_billing_rules ADD COLUMN fixed_credits_per_purchase INTEGER DEFAULT 0')
    if (sceneRuleCols.some((col) => col.name === 'fixed_credits_per_use')) db.exec('UPDATE scene_billing_rules SET fixed_credits_per_purchase = fixed_credits_per_use WHERE fixed_credits_per_purchase = 0')
  }
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
      usage_source TEXT,
      usage_trust_level TEXT,
      reported_by_connector_id TEXT,
      reported_at INTEGER,
      raw_usage_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      snapshot_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
    )
  `)
  const usageCols = db.prepare('PRAGMA table_info(metered_usage_events)').all() as any[]
  if (!usageCols.some((col) => col.name === 'usage_source')) db.exec('ALTER TABLE metered_usage_events ADD COLUMN usage_source TEXT')
  if (!usageCols.some((col) => col.name === 'usage_trust_level')) db.exec('ALTER TABLE metered_usage_events ADD COLUMN usage_trust_level TEXT')
  if (!usageCols.some((col) => col.name === 'reported_by_connector_id')) db.exec('ALTER TABLE metered_usage_events ADD COLUMN reported_by_connector_id TEXT')
  if (!usageCols.some((col) => col.name === 'reported_at')) db.exec('ALTER TABLE metered_usage_events ADD COLUMN reported_at INTEGER')
  if (!usageCols.some((col) => col.name === 'raw_usage_json')) db.exec('ALTER TABLE metered_usage_events ADD COLUMN raw_usage_json TEXT')
  db.exec(`CREATE INDEX IF NOT EXISTS idx_metered_usage_events_status_created ON metered_usage_events(status, created_at)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_metered_usage_events_payer ON metered_usage_events(payer_user_id, created_at)`)
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_ledger_entries (
      id TEXT PRIMARY KEY,
      usage_event_id TEXT,
      run_id TEXT,
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
      FOREIGN KEY (usage_event_id) REFERENCES metered_usage_events(id) ON DELETE SET NULL,
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE SET NULL
    )
  `)
  ensureBillingLedgerRetentionForeignKeys(db)
  ensureCreditTransactionsLedgerForeignKey(db)
  ensureAgentPurchasesLedgerForeignKey(db)
  const agentPurchaseCols = db.prepare('PRAGMA table_info(agent_purchases)').all() as any[]
  if (!agentPurchaseCols.some((col) => col.name === 'status')) db.exec("ALTER TABLE agent_purchases ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'")
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
  ensureCreditTransactionsLedgerForeignKey(db)
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
  ensureMicrocreditMigration(db)
}
