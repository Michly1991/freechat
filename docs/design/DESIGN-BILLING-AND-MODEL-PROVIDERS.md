# Billing and Model Providers Design

## Goal

FreeChat billing is based on Agent runs, but accounting is split into three roles:

1. **Agent provider**: owner of the Agent template. They earn credits when rooms use their template.
2. **Model provider**: owner of the key/base URL model profile. This can be a normal user or a platform system user.
3. **Usage payer**: creator of the project room (`rooms.created_by`). Collaborators can participate in discussion and view shared results, but by default only the room creator can command Agent runs. All model and Agent runtime fees in the room are charged to the creator. Future sharing can allow selected collaborators to command Agents, while still charging the creator.

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

Model market pricing uses `model_billing_rules`. `1 credit` is product-defined to roughly reference `1 RMB/CNY`, and internal storage uses `1 credit = 10000 microcredits`. Model prices must stay near real RMB token-cost magnitude rather than inflated platform points. API/UI fields remain expressed in credits; DB integer amount columns store microcredits after the `billing_amount_unit = microcredit_10000` metadata migration. Current platform bootstrap defaults are:

```text
economy  = input 1 / output 1 / cache write 1 / cache read 0 credits per million tokens
standard = input 1 / output 2 / cache write 1 / cache read 0 credits per million tokens
premium  = input 1 / output 2 / cache write 1 / cache read 0 credits per million tokens
```

Model names containing `mini|lite|flash|turbo|small` use economy. Names containing `max|pro|plus|code|reason|thinking|r1|o1|o3` use premium. Others use standard. Minimum per run stays `0` in development to avoid blocking users with empty wallets. Runtime charges are rounded up to the nearest microcredit, not the nearest public credit.

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
custom assistant: low per-token Agent service fee
specialist Agent: low per-token Agent service fee
built-in scene: free 🎁
custom scene: fixed 20 credits one-time purchase
```

Agent service fee is not buyout/purchase based. Following or adding an Agent to a room does not deduct credits. Agent providers earn only when their Agent actually runs, and the service fee is calculated from token usage. Model usage and Agent service usage are billed as separate runtime ledger rows for clarity.

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

Defines Agent-template service fee rules. Current supported modes:

- `free`
- `per_token`

Prices are stored as microcredits per million tokens, separated by token class:

```sql
agent_billing_rules (
  agent_template_id,
  billing_mode,
  input_credit_per_million,
  output_credit_per_million,
  cache_write_credit_per_million,
  cache_read_credit_per_million,
  revenue_share_rate,
  enabled
)
```

Legacy `fixed_credits_per_run`, `fixed_credits_per_purchase`, and `agent_purchases` are not part of the active Agent billing model. They may exist in development databases for historical rows only. Active runtime billing emits `agent_usage_charge` for the payer and `agent_income` for the Agent provider.

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
  amount INTEGER NOT NULL, -- microcredits
  currency TEXT DEFAULT 'MICRO_CREDIT',
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

Wallet changes must reference `billing_ledger_entries` where possible. Development databases may contain an older `credit_transactions.ledger_id -> billing_ledger(id)` foreign key; schema initialization must detect and rebuild that table so wallet transactions point at `billing_ledger_entries(id)`. Billing failures must be logged instead of silently returning an empty ledger.

### billing_daily_stats

Materialized daily projection for trends and summaries. It can be rebuilt from ledger entries.

## Charge Formula

```text
model_charge_micro = token class prices from model_billing_rules  # stored as microcredits per million tokens
agent_charge_micro = token class prices from agent_billing_rules  # skipped for own Agent or free Agent
usage_total_micro  = model_charge_micro + agent_charge_micro

total_tokens = input_tokens + output_tokens + cache_write_tokens + cache_read_tokens

Public API fields such as `inputCreditPerMillion`, wallet `balance`, and ledger `credit_amount` are expressed in credits. Database columns keep legacy names such as `*_credits`, but their stored integer unit is microcredits.
```

Ledger entries:

```text
payer          debit  model_usage_charge
payer          debit  agent_usage_charge
model provider credit model_income
Agent provider credit agent_income
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

First version uses only deterministic runtime minimums:

```text
model_billing_rules.min_credits_per_run
```

Agent add/follow does not charge immediately. Agent token service fees are charged at run completion. Future preflight may estimate Agent token service fees together with model minimums.

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

Top-level home tabs include a standalone `账单` tab. Billing is not nested under market.

The billing page shows four role views:

- usage payer bill
- Agent provider income
- model provider income
- scene provider income

Within each role view, the `维度分析` area uses tabs instead of separate cramped cards:

- `项目`: project/room aggregation.
- `Agent`: canonical Agent template aggregation, merging room clones through `agent_template_id/source_template_id`.
- `模型`: model/profile aggregation.
- `场景购买` / `场景收入`: scene purchase fee/income aggregation from `scene_purchase` / `scene_income`; this is intentionally separate from project runtime cost.
- `每日`: daily trend aggregation.

Recent ledger rows are grouped by run for runtime entries. One visible runtime row shows model fee, Agent fee, and total credit side by side. Standalone purchases remain standalone rows.

Wallet/billing reconciliation rule:

- Development audits can run `node scripts/audit-billing-dev.mjs`; it verifies every user's `credit_accounts` against `credit_transactions`, linked ledger wallet transactions, Agent/scene purchase deductions/income, pending usage events, and stale runs. Basic smoke coverage can run `node scripts/smoke-freechat-dev.mjs`; it covers auth, balance gate, Agent create/delete, room Agent add/remove, resource lists, billing APIs, and room create/get/delete.
- Revenue transaction types are `agent_income`, `model_income`, `platform_income`, and `scene_income`; they must increase `income_balance`, not spendable `balance`.
- model runtime charges normally come from `billing_ledger_entries`.
- Agent runtime service charges are `agent_usage_charge` payer rows and `agent_income` provider rows.
- Scene purchases are projected from `scene_purchases` as `scene_purchase` payer entries and `scene_income` scene-provider entries.
- Legacy/orphan wallet deductions such as `credit_transactions.type='usage_charge'` with no surviving ledger row are still shown as wallet-backed billing rows so wallet balance and账单支出 stay reconcilable.

Settings no longer contains `我的模型`; model service configuration lives in the resource management flow.
