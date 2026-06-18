# Billing and Model Providers Design

## Goal

FreeChat billing is based on Agent runs, but accounting is split into three roles:

1. **Agent provider**: owner of the Agent template. They earn credits when rooms use their template.
2. **Model provider**: owner of the key/base URL model profile. This can be a normal user or a platform system user.
3. **Usage payer**: owner of the project room that introduced the Agent. Project collaborators may trigger runs, but the room owner pays.

The runtime model is configured on the **room Agent instance**, not on the whole room.

## Domain Boundaries

Billing is separated into small domains:

```text
model-provider      model profiles, encrypted key/baseUrl, model token rules, platform model bootstrap
agent-product       Agent template service fee rules
usage-metering      converts Agent run facts into immutable usage events
billing             calculates charges and creates accounting entries
wallet              credit balances and wallet transactions
billing-analytics   daily/materialized stats and trends
```

Code should follow this dependency direction:

```text
routes -> services -> repositories -> db
              |
              -> pure calculators
```

Routes should not contain SQL. Runtime should not know billing table details; it should call preflight/capture services.

## Event Flow

```text
Agent run preflight
  -> billingPreflightService.checkRoomAgentInvocation(roomId, agentId)
  -> reject only when a minimum charge is known and payer balance is too low

Agent run finishes
  -> agent_runs records execution facts
  -> usageMeteringService.captureRun(runId)
  -> billingService.chargeUsageEvent(eventId)
  -> walletService applies ledger entries to balances
  -> billingAggregationService refreshes daily stats asynchronously
```

## Role Resolution

For each metered usage event:

```text
payer_user_id          = rooms.created_by
agent_template_id      = agents.source_template_id OR agent_id
agent_provider_user_id = owner of agent_template_id
model_provider_user_id = model_profiles.owner_id
platform provider      = user_platform_model_provider via platform model_profiles
```

## Marketplace Billing Surfaces

FreeChat has three marketplace-style products:

1. **AI market**: Agent templates. Others see public summary + price; owner/admin/editor sees full prompt, skills, scripts, permissions, and pricing editor.
2. **Model market**: model profiles backed by provider `apiKey` + `baseUrl`. Others see provider summary, host, default/supported models, publisher, and price. Only owner/admin sees full baseUrl, key last4, and edit form.
3. **Scene market**: scene templates. Others see summary, included AI list, publisher, and scene price. Owner/admin/editor can edit scene composition and pricing.

Model market pricing uses `model_billing_rules`. Platform bootstrap assigns default model prices by tier:

```text
economy  = input 50 / output 200 / cache write 50 / cache read 10 credits per million tokens
standard = input 100 / output 400 / cache write 100 / cache read 20 credits per million tokens
premium  = input 200 / output 800 / cache write 200 / cache read 40 credits per million tokens
```

Model names containing `mini|lite|flash|turbo|small` use economy. Names containing `max|pro|plus|code|reason|thinking|r1|o1|o3` use premium. Others use standard. Minimum per run stays `0` in development to avoid blocking users with empty wallets.

Scene market pricing uses:

```sql
scene_billing_rules (
  scene_template_id,
  billing_mode,
  fixed_credits_per_purchase,
  revenue_share_rate,
  enabled
)
```

Current MVP supports free/fixed scene one-time purchase pricing for display and future purchase hooks. A scene is bought once; later runtime cost comes from the included Agents and selected model providers.

Default marketplace pricing bootstrap fills missing rules without overriding owner-edited rules:

```text
native/default assistant: free Agent service fee
custom assistant: fixed 2 credits/run + 10% model fee + input 20/output 80 per million tokens
specialist Agent: fixed 5 credits/run + 20% model fee + input 50/output 200 per million tokens
built-in scene: free 🎁
custom scene: fixed 20 credits one-time purchase
```

## Native Assistant Free Agent Fee

FreeChat's built-in/default assistant is a native platform capability, not a paid Agent product.

Rules:

- Built-in/default assistant Agent service fee is always `0`.
- It does not generate `agent_income` ledger entries.
- Model usage is still metered separately through the selected model profile.
- If the assistant uses a platform model, model provider billing can still apply.
- If the assistant uses a user-owned key, token usage is still recorded but platform model charges depend on that model profile's rules.

Implementation guardrail:

- Billing ignores Agent billing rules for assistant templates whose config contains `builtInKey: default_assistant` or `defaultRoomAssistant: true`.
- This protects against accidental rule misconfiguration while preserving model-provider accounting.

## Runtime Model Binding

The long-term normalized model is:

```sql
room_agent_model_bindings (
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
  PRIMARY KEY (room_id, agent_id)
)
```

The frontend still receives `Agent.roomModelConfig`, but the source of truth is this normalized binding table.

## Core Tables

### model_profiles

Stores key/base URL providers. API keys are encrypted with AES-GCM and never returned by public APIs.

```sql
model_profiles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL DEFAULT 'anthropic-compatible',
  base_url TEXT,
  api_key_cipher TEXT,
  api_key_last4 TEXT,
  default_model TEXT,
  models TEXT,
  visibility TEXT NOT NULL DEFAULT 'private', -- private/shared/platform
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

### model_billing_rules

Defines model-provider charge to the payer by token class. Vendor cost is intentionally not modeled.

### agent_billing_rules

Defines Agent-template service fee rules. First supported modes:

- `free`
- `token_multiplier`
- `fixed_per_run` via fixed credits
- optional direct per-token Agent prices

### metered_usage_events

The usage-metering fact table. Billing should read this table instead of directly interpreting `agent_runs`.

```sql
metered_usage_events (
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
  status TEXT NOT NULL DEFAULT 'pending', -- pending / charged / ignored / failed
  snapshot_json TEXT,
  created_at INTEGER NOT NULL
)
```

### billing_ledger_entries

Normalized account-entry ledger. One row belongs to one account/user and one role.

```sql
billing_ledger_entries (
  id TEXT PRIMARY KEY,
  usage_event_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  account_user_id TEXT NOT NULL,
  account_role TEXT NOT NULL, -- payer / agent_provider / model_provider / platform
  direction TEXT NOT NULL,    -- debit / credit
  entry_type TEXT NOT NULL,   -- usage_charge / agent_income / model_income / refund / adjustment
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'CREDIT',
  room_id TEXT,
  agent_id TEXT,
  agent_template_id TEXT,
  model_profile_id TEXT,
  model TEXT,
  token_snapshot_json TEXT,
  rule_snapshot_json TEXT,
  created_at INTEGER NOT NULL
)
```

Development-stage builds use `billing_ledger_entries` directly.

### Wallet

```text
credit_accounts      spendable balance + income balance
credit_transactions  immutable balance movements referencing ledger entries
```

Wallet changes must reference ledger entries where possible.

### billing_daily_stats

Materialized daily projection for trends and summaries. It can be rebuilt from ledger entries.

## Charge Formula

```text
model_charge = token class prices from model_billing_rules
agent_charge = fixed_per_run + per-token Agent prices + model_charge * token_multiplier
usage_total  = model_charge + agent_charge
```

Ledger entries:

```text
payer          debit  usage_total
model provider credit model_charge
Agent provider credit agent_charge
```

A future platform share can be represented by additional credit entries and adjusted provider credits.

## Preflight Rule

Before invocation:

```ts
billingPreflightService.checkRoomAgentInvocation({ roomId, agentId })
```

Allowed when:

- no billable minimum is known, or
- payer balance is greater than/equal to known minimum charge.

Denied when:

- known minimum charge exists and balance is insufficient.

First version uses only deterministic minimums:

```text
model_billing_rules.min_credits_per_run + agent_billing_rules.fixed_credits_per_run
```

Later versions may estimate context tokens and freeze balance.

## Aggregation

Synchronous path:

- finish `agent_runs`.
- capture usage event.
- calculate and write normalized ledger entries.
- apply wallet transactions.

Asynchronous path:

- rebuild daily stats from `billing_ledger_entries`.
- compensate failed/pending usage events.
- charts and rankings read projections where possible.

## UI

Top-level home tabs include `市场` next to `设置`; billing is no longer a standalone top-level tab.

The market page contains `AI市场 / 模型市场 / 场景市场 / 我的账单`. The billing sub-tab shows three views:

- usage payer bill
- Agent provider income
- model provider income

Settings keeps `我的模型` because key/baseUrl are configuration, not a bill.
