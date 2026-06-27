# Billing and Model Providers Design

## Goal

FreeChat billing is based on Agent runs. Runtime accounting can include two independent token-based charges:

1. **Agent service fee**: optional token price set by the Agent owner. Default/missing Agent rules are free. When configured as `per_token`, the usage payer pays the Agent owner.
2. **Model fee**: token price set by the model profile/platform provider. The usage payer pays the model provider when a billable FreeChat model rule can be resolved.
3. **Scene fee**: optional one-time scene purchase fee.

Core rule: **Agent is token-billable only after the owner explicitly sets a per-token price; otherwise it is free.** Model billing depends on who hosts the runtime:

- **Client-hosted Agent (`deployment='client'`, `runtime='remote-claude-code'`, or `usage_source='client_reported'`)**: Agent Client reports token usage to FreeChat Server. Server reads the corresponding Agent rule and charges only the Agent service fee to the Agent creator/owner. It does **not** calculate or charge platform model fees, because the model/API key/runtime cost is borne outside FreeChat by the client host.
- **Platform/server-provided Agent runtime**: Server calculates Agent service fee for the Agent owner and model fee for the platform/model provider separately. If the room Agent is bound to a model profile owned by the payer, the model is treated as user-owned infrastructure: server may call that profile's encrypted API key, records trusted usage, but model fee is zero.

The runtime model is configured on the **room Agent instance**, not on the whole room.

## Domain Boundaries

```text
model-provider      model profiles, encrypted key/baseUrl, model token rules, platform model bootstrap
model-runtime       resolves room-agent model binding and calls platform/user/shared model profiles
usage-metering      converts Agent run facts into immutable usage events
billing             calculates Agent/model charges and creates accounting entries
wallet              credit balances and wallet transactions
billing-analytics   daily/materialized stats and trends
```

## Event Flow

```text
Agent run preflight
  -> billingService.checkRoomAgentInvocation(roomId, agentId, actorUserId)
  -> reject only when a known minimum charge exceeds payer balance

Agent run finishes
  -> agent_runs records execution facts
  -> usageRepository.createFromRun(runId)
  -> billingService.billRun(runId)
  -> walletService applies model/Agent ledger entries to balances
```

Creating rooms, creating Agents, adding/following Agents, or joining a workgroup entry must not be blocked by empty credit balance. Balance checks only apply immediately before invoking a run when a deterministic minimum charge is known.

## Role Resolution

```text
payer_user_id          = actorUserId when present, else rooms.created_by, else Agent owner
agent_template_id      = agents.source_template_id OR agent_id
agent_provider_user_id = owner of agent_template_id
model_provider_user_id = model_profiles.owner_id, except payer-owned profiles where model_provider_user_id is null for billing
platform provider      = user_platform_model_provider via platform model_profiles
model_source           = platform / marketplace / user_owned / client_reported / system_default
```

Agent service fee is not charged when the payer is also the Agent provider.

## Marketplace Billing Surfaces

- **AI market**: Agent templates. Others see public summary; owner/admin/editor sees full prompt, skills, scripts, permissions, and Agent token price. Agent price defaults to free.
- **Model market**: model profiles backed by provider `apiKey + baseUrl + models`. Pricing uses `model_billing_rules`. A profile owned by the payer is considered a bring-your-own-model profile and does not create `model_usage_charge` for that payer.
- **Scene market**: scene templates. Current MVP supports free/fixed one-time purchase pricing.

Platform model pricing uses separate input/output token prices. Output is priced at `2 USD / 1M tokens`; input/cache-write is priced lower at `1 USD / 1M tokens`. In current credit UI/API this is represented as input `1`, output `2`, cache write `1`, and cache read `0` credits per 1M tokens. Minimum per run stays `0` in development to avoid blocking users with empty wallets. Runtime charges are rounded up to the nearest microcredit, not the nearest public credit.

Current platform bootstrap defaults are:

```text
platform = input 1 / output 2 / cache write 1 / cache read 0 credits per million tokens
```

Agent market/runtime pricing uses `agent_billing_rules`:

```text
missing rule or billing_mode='free' -> Agent fee 0
billing_mode='per_token'            -> charge by token class prices
min_credits_per_run                 -> optional minimum, applied only when token price produced a positive Agent charge
model_free_runs_per_day             -> daily per-user free model-charge runs for this Agent/template; 0 means no quota
model_overage_policy='charge'        -> over quota, charge normal model fee
```

Default marketplace pricing bootstrap fills missing Agent rules as `free` and does not override owner-edited rules. Platform built-in `小蜜` seeds `model_free_runs_per_day = 20` and `model_overage_policy = 'charge'`: each user gets 20 free model-charge replies per natural day, then normal model fees apply.

## Core Tables

### `model_billing_rules`

Defines model-provider charge to the payer by token class. Vendor cost is intentionally not modeled.

### `agent_billing_rules`

Active Agent service pricing table.

```sql
agent_billing_rules (
  id TEXT PRIMARY KEY,
  agent_template_id TEXT NOT NULL UNIQUE,
  billing_mode TEXT NOT NULL DEFAULT 'free', -- free / per_token
  input_credit_per_million INTEGER DEFAULT 0,
  output_credit_per_million INTEGER DEFAULT 0,
  cache_write_credit_per_million INTEGER DEFAULT 0,
  cache_read_credit_per_million INTEGER DEFAULT 0,
  min_credits_per_run INTEGER DEFAULT 0,
  model_free_runs_per_day INTEGER DEFAULT 0,
  model_overage_policy TEXT DEFAULT 'charge', -- charge / block (block reserved)
  revenue_share_rate REAL DEFAULT 1,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)
```

Legacy columns like `token_multiplier`, `fixed_credits_per_run`, and `fixed_credits_per_purchase` may remain for compatibility, but active runtime Agent fee uses only `free/per_token` and token price columns. `model_free_runs_per_day` is a model-fee quota, not Agent service pricing; it can be used by any Agent, including built-ins.

### `metered_usage_events`

The usage-metering fact table. Billing reads this table instead of directly interpreting `agent_runs`. Client-reported remote runs keep reported model information for audit/display, but active billing for those runs uses Agent pricing only and must not resolve the model into platform model charges.

### `billing_ledger_entries`

Normalized account-entry ledger. Runtime entries include:

```text
payer          debit  model_usage_charge
model provider credit model_income
payer          debit  agent_usage_charge    # only when Agent per_token charge > 0
Agent provider credit agent_income          # only when Agent per_token charge > 0
```

### Wallet

`credit_accounts` stores spendable balance and income balance. Revenue transaction types including `agent_income`, `model_income`, `platform_income`, and `scene_income` increase `income_balance`, not spendable `balance`.

Newly registered users receive an initial wallet top-up of `1000 credits` (`10,000,000 microcredits`) via `signup_bonus`.

## Pricing Domain

Runtime pricing is normalized through the server-side `domains/pricing` layer before wallet settlement:

```text
pricing-policy.repository  DB rows -> normalized pricing policies
pricing-engine             pure charge calculation, no DB writes
billing.service            orchestration: usage event -> policy -> promotion usage -> ledger/wallet
```

The normalized model separates three concepts:

1. **Model fee** from `model_billing_rules`.
2. **Agent service fee** from `agent_billing_rules.billing_mode` and Agent token prices.
3. **Promotions / free quota** from server-side promotion policy, currently backed by `agent_billing_rules.model_free_runs_per_day`.

Client UI may show or submit pricing configuration, but it never decides whether an invocation is free. The server calculates promotion usage and final charge during settlement.

## Charge Formula

```text
model_charge_micro = token class prices from model_billing_rules, unless Agent model_free_runs_per_day quota still has remaining runs for the payer today, or model_source='user_owned'
agent_charge_micro = token class prices from agent_billing_rules when billing_mode='per_token'; otherwise 0
usage_total_micro  = model_charge_micro + agent_charge_micro

total_tokens = input_tokens + output_tokens + cache_write_tokens + cache_read_tokens
```

Charges are rounded up to the nearest microcredit. Free model-charge quota is a **server-side billing rule**. The frontend may display the configured quota, but it must not decide whether a run is free or paid. Runtime preflight and final settlement both read `agent_billing_rules.model_free_runs_per_day` on the server and count settled usage by `(payer_user_id, agent_template_id, natural day)`. Platform-hosted built-ins such as 小蜜 must report trusted server-metered token usage from the server-side model response; if the model call falls back without usage, the run is recorded as non-billable usage audit instead of letting the client mark it free.

User-owned model profiles are a separate server-side rule: if the resolved model profile owner is the payer, usage is recorded with `model_source='user_owned'`, model-provider income is disabled, and model charge is forced to zero. This applies to 小蜜 and other platform-hosted Agents when the current room Agent binding points to the payer's own profile. Agent service fee remains governed by the Agent's billing rule; 小蜜's Agent service fee remains free.


## Workgroup Share / Visitor Billing

- Workgroup share links are public entry links for logged-in users.
- Link users are **visitors**, not workgroup members. Joining an entry must not insert them into `workgroup_members`.
- Each visitor gets/reuses a private `room_kind='entry'` room for the same `(user, entry)` pair.
- The visitor/room creator is the payer for both Agent fee and model fee.
- Workgroup owner/admin can see visitor sessions separately from formal members.
- The entry URL directly joins and redirects to `/room/:id`; unauthenticated users log in first and then resume the redirect.

## Client-hosted vs Platform Agent Billing

Client-hosted Agent billing:

```text
Agent Client -> reports token usage bill to Server
Server       -> loads agent_billing_rules for agent_template_id
payer        -> debit agent_usage_charge when Agent rule is per_token and amount > 0
Agent owner  -> credit agent_income
model fee    -> always 0 for this run, even if reported model name matches a platform model
```

Platform/server-provided Agent billing:

```text
payer        -> debit agent_usage_charge when Agent rule is per_token and amount > 0
Agent owner  -> credit agent_income
payer        -> debit model_usage_charge when model rule is billable and model_source is not user_owned
model owner/platform -> credit model_income
```

Bring-your-own model profile for platform-hosted Agent:

```text
room Agent binding -> payer-owned model_profile_id
server runtime     -> calls that profile baseUrl/apiKey
usage event        -> model_source='user_owned'
model fee          -> 0, no model_income entry
Agent fee          -> unchanged by this rule; 小蜜 remains free
```

This keeps Agent value and model infrastructure cost separate. Tina's current Agent service pricing is:

```text
input  = 0.5 credit / 1M tokens
output = 1 credit / 1M tokens
cache write = 0.5 credit / 1M tokens
cache read  = 0.05 credit / 1M tokens
minimum per run = 0
```

## UI

Billing page role views:

- payer bill
- Agent provider income
- model provider income
- scene provider income

Runtime rows are grouped by run and display model fee, Agent fee, and total side by side. Agent configuration exposes a compact pricing form: free by default, or per-token input/output/cache prices plus optional minimum.
